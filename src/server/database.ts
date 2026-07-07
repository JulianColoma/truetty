/**
 * MÓDULO DE BASE DE DATOS - SQLite para KeyPass Auth
 * 
 * Persiste sesiones, delegaciones y auditoría en SQLite.
 * Usa better-sqlite3 para operaciones síncronas y rápidas.
 * 
 * Tablas:
 * - sessions: Sesiones activas con JWT y metadata
 * - delegations: Historial de delegaciones criptográficas
 * - audit_log: Log de auditoría de eventos importantes
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export interface Session {
  id: string; // UUID
  salaId: string;
  jwt: string;
  clavePublicaEfimera: string; // JWK como JSON string
  clavePublicaMaestra: string; // JWK como JSON string
  estado: "activa" | "revocada" | "expirada";
  creado_en: number; // Timestamp Unix
  expira_en: number; // Timestamp Unix
  revocado_en?: number; // Timestamp Unix (si fue revocado)
  dispositivo_id?: string;
}

export interface Delegation {
  id: string; // UUID
  salaId: string;
  payload: string; // JSON string del payload
  firma: string; // Firma en hex
  clavePublicaMaestra: string; // JWK como JSON string
  valido: boolean;
  creado_en: number; // Timestamp Unix
  mensaje?: string; // Mensaje de error si no fue válido
}

export interface AuditLog {
  id: string; // Auto-increment
  evento: string; // Tipo de evento
  salaId?: string;
  sessionId?: string;
  detalles: string; // JSON string con detalles
  timestamp: number; // Timestamp Unix
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const DB_DIR = join(process.cwd(), "data");
const DB_PATH = join(DB_DIR, "keypass.db");

let db: Database.Database | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicializa la base de datos y crea las tablas si no existen
 */
export function initDatabase(): void {
  console.log("🗄️  [DB] Inicializando base de datos SQLite...");

  // Crear directorio si no existe
  if (!existsSync(DB_DIR)) {
    mkdirSync(DB_DIR, { recursive: true });
    console.log(`📁 [DB] Directorio creado: ${DB_DIR}`);
  }

  // Abrir/crear base de datos
  db = new Database(DB_PATH);

  // Configurar pragmas para mejor rendimiento
  db.pragma("journal_mode = WAL"); // Write-Ahead Logging para mejor concurrencia
  db.pragma("synchronous = NORMAL"); // Balance entre seguridad y rendimiento

  // Crear tablas
  crearTablas();

  console.log("✅ [DB] Base de datos inicializada");
  console.log(`   Ubicación: ${DB_PATH}`);
}

/**
 * Crea las tablas necesarias si no existen
 */
function crearTablas(): void {
  if (!db) throw new Error("Base de datos no inicializada");

  console.log("📊 [DB] Creando tablas...");

  // Tabla de sesiones
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      salaId TEXT NOT NULL,
      jwt TEXT NOT NULL,
      clavePublicaEfimera TEXT NOT NULL,
      clavePublicaMaestra TEXT NOT NULL,
      estado TEXT NOT NULL CHECK(estado IN ('activa', 'revocada', 'expirada')),
      creado_en INTEGER NOT NULL,
      expira_en INTEGER NOT NULL,
      revocado_en INTEGER,
      dispositivo_id TEXT
    )
  `);

  // Índice para buscar sesiones por salaId
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_salaId ON sessions(salaId)
  `);

  // Índice para buscar sesiones por estado
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_estado ON sessions(estado)
  `);

  // Tabla de delegaciones
  db.exec(`
    CREATE TABLE IF NOT EXISTS delegations (
      id TEXT PRIMARY KEY,
      salaId TEXT NOT NULL,
      payload TEXT NOT NULL,
      firma TEXT NOT NULL,
      clavePublicaMaestra TEXT NOT NULL,
      valido INTEGER NOT NULL CHECK(valido IN (0, 1)),
      creado_en INTEGER NOT NULL,
      mensaje TEXT
    )
  `);

  // Índice para buscar delegaciones por salaId
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_delegations_salaId ON delegations(salaId)
  `);

  // Tabla de auditoría
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      evento TEXT NOT NULL,
      salaId TEXT,
      sessionId TEXT,
      detalles TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  // Índice para buscar logs por timestamp
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)
  `);

  // Índice para buscar logs por evento
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_evento ON audit_log(evento)
  `);

  console.log("✅ [DB] Tablas creadas");
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIONES DE SESIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una nueva sesión en la base de datos
 */
export function crearSesion(session: Session): void {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(`
    INSERT INTO sessions (
      id, salaId, jwt, clavePublicaEfimera, clavePublicaMaestra,
      estado, creado_en, expira_en, dispositivo_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    session.id,
    session.salaId,
    session.jwt,
    session.clavePublicaEfimera,
    session.clavePublicaMaestra,
    session.estado,
    session.creado_en,
    session.expira_en,
    session.dispositivo_id || null
  );

  console.log(`✅ [DB] Sesión creada: ${session.id}`);
}

/**
 * Obtiene una sesión por su ID
 */
export function obtenerSesion(id: string): Session | null {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare("SELECT * FROM sessions WHERE id = ?");
  const row = stmt.get(id) as any;

  if (!row) return null;

  return {
    ...row,
    estado: row.estado as "activa" | "revocada" | "expirada",
  };
}

/**
 * Obtiene una sesión por salaId
 */
export function obtenerSesionPorSala(salaId: string): Session | null {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(
    "SELECT * FROM sessions WHERE salaId = ? AND estado = 'activa' ORDER BY creado_en DESC LIMIT 1"
  );
  const row = stmt.get(salaId) as any;

  if (!row) return null;

  return {
    ...row,
    estado: row.estado as "activa" | "revocada" | "expirada",
  };
}

/**
 * Revoca una sesión
 */
export function revocarSesion(id: string): boolean {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(`
    UPDATE sessions
    SET estado = 'revocada', revocado_en = ?
    WHERE id = ? AND estado = 'activa'
  `);

  const result = stmt.run(Date.now(), id);
  return result.changes > 0;
}

/**
 * Obtiene todas las sesiones activas
 */
export function obtenerSesionesActivas(): Session[] {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(
    "SELECT * FROM sessions WHERE estado = 'activa' ORDER BY creado_en DESC"
  );
  const rows = stmt.all() as any[];

  return rows.map((row) => ({
    ...row,
    estado: row.estado as "activa" | "revocada" | "expirada",
  }));
}

/**
 * Marca sesiones expiradas
 */
export function marcarSesionesExpiradas(): number {
  if (!db) throw new Error("Base de datos no inicializada");

  const ahora = Date.now();
  const stmt = db.prepare(`
    UPDATE sessions
    SET estado = 'expirada'
    WHERE estado = 'activa' AND expira_en < ?
  `);

  const result = stmt.run(ahora);
  return result.changes;
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIONES DE DELEGACIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra una delegación en la base de datos
 */
export function registrarDelegacion(delegation: Delegation): void {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(`
    INSERT INTO delegations (
      id, salaId, payload, firma, clavePublicaMaestra, valido, creado_en, mensaje
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    delegation.id,
    delegation.salaId,
    delegation.payload,
    delegation.firma,
    delegation.clavePublicaMaestra,
    delegation.valido ? 1 : 0,
    delegation.creado_en,
    delegation.mensaje || null
  );

  console.log(`✅ [DB] Delegación registrada: ${delegation.id}`);
}

/**
 * Obtiene el historial de delegaciones de una sala
 */
export function obtenerDelegacionesPorSala(salaId: string): Delegation[] {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(
    "SELECT * FROM delegations WHERE salaId = ? ORDER BY creado_en DESC"
  );
  const rows = stmt.all(salaId) as any[];

  return rows.map((row) => ({
    ...row,
    valido: row.valido === 1,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIONES DE AUDITORÍA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra un evento en el log de auditoría
 */
export function registrarAuditLog(log: Omit<AuditLog, "id">): void {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(`
    INSERT INTO audit_log (evento, salaId, sessionId, detalles, timestamp)
    VALUES (?, ?, ?, ?, ?)
  `);

  stmt.run(log.evento, log.salaId || null, log.sessionId || null, log.detalles, log.timestamp);
}

/**
 * Obtiene el log de auditoría (últimos N eventos)
 */
export function obtenerAuditLog(limit: number = 100): AuditLog[] {
  if (!db) throw new Error("Base de datos no inicializada");

  const stmt = db.prepare(
    "SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?"
  );
  return stmt.all(limit) as AuditLog[];
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas de la base de datos
 */
export function obtenerEstadisticasDB(): {
  totalSesiones: number;
  sesionesActivas: number;
  sesionesRevocadas: number;
  sesionesExpiradas: number;
  totalDelegaciones: number;
  delegacionesValidas: number;
  totalAuditLogs: number;
} {
  if (!db) throw new Error("Base de datos no inicializada");

  const totalSesiones = (db.prepare("SELECT COUNT(*) as count FROM sessions").get() as any).count;
  const sesionesActivas = (db.prepare("SELECT COUNT(*) as count FROM sessions WHERE estado = 'activa'").get() as any).count;
  const sesionesRevocadas = (db.prepare("SELECT COUNT(*) as count FROM sessions WHERE estado = 'revocada'").get() as any).count;
  const sesionesExpiradas = (db.prepare("SELECT COUNT(*) as count FROM sessions WHERE estado = 'expirada'").get() as any).count;
  const totalDelegaciones = (db.prepare("SELECT COUNT(*) as count FROM delegations").get() as any).count;
  const delegacionesValidas = (db.prepare("SELECT COUNT(*) as count FROM delegations WHERE valido = 1").get() as any).count;
  const totalAuditLogs = (db.prepare("SELECT COUNT(*) as count FROM audit_log").get() as any).count;

  return {
    totalSesiones,
    sesionesActivas,
    sesionesRevocadas,
    sesionesExpiradas,
    totalDelegaciones,
    delegacionesValidas,
    totalAuditLogs,
  };
}

/**
 * Cierra la conexión a la base de datos
 */
export function cerrarDatabase(): void {
  if (db) {
    db.close();
    db = null;
    console.log("✅ [DB] Base de datos cerrada");
  }
}

/**
 * Obtiene la instancia de la base de datos (para operaciones avanzadas)
 */
export function getDatabase(): Database.Database {
  if (!db) throw new Error("Base de datos no inicializada");
  return db;
}
