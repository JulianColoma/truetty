/**
 * MÓDULO JWT - JSON Web Tokens para KeyPass Auth
 * 
 * Implementa generación y verificación de JWTs firmados con ECDSA P-256.
 * Los JWTs reemplazan los session tokens simples y proporcionan:
 * - Firma criptográfica verificable
 * - Expiración automática
 * - Payload estructurado
 * - Estándar RFC 7519
 */

import jwt from "jsonwebtoken";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

export interface JWTPayload {
  salaId: string;
  dispositivoId?: string;
  clavePublicaEfimera?: any; // JWK de la clave pública efímera
  iat?: number; // Issued at (automático)
  exp?: number; // Expiration (automático)
  jti?: string; // JWT ID (automático)
}

export interface JWTConfig {
  privateKey: string;
  publicKey: string;
  algorithm: "ES256"; // ECDSA con P-256
  expiresIn: string; // Ej: "2h", "7d", "30m"
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const KEYS_DIR = join(process.cwd(), "keys");
const PRIVATE_KEY_PATH = join(KEYS_DIR, "jwt-private.pem");
const PUBLIC_KEY_PATH = join(KEYS_DIR, "jwt-public.pem");

let jwtConfig: JWTConfig | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// GESTIÓN DE CLAVES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un par de claves ECDSA P-256 para firmar JWTs
 */
function generateJWTKeys(): { privateKey: string; publicKey: string } {
  console.log("🔑 [JWT] Generando par de claves ECDSA P-256 para JWT...");
  
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
  });

  return { privateKey, publicKey };
}

/**
 * Carga o genera las claves JWT
 */
function loadOrGenerateKeys(): JWTConfig {
  // Crear directorio si no existe
  if (!existsSync(KEYS_DIR)) {
    mkdirSync(KEYS_DIR, { recursive: true });
    console.log(`📁 [JWT] Directorio creado: ${KEYS_DIR}`);
  }

  let privateKey: string;
  let publicKey: string;

  // Cargar claves existentes o generar nuevas
  if (existsSync(PRIVATE_KEY_PATH) && existsSync(PUBLIC_KEY_PATH)) {
    console.log("🔑 [JWT] Cargando claves JWT existentes...");
    privateKey = readFileSync(PRIVATE_KEY_PATH, "utf-8");
    publicKey = readFileSync(PUBLIC_KEY_PATH, "utf-8");
  } else {
    console.log("🔑 [JWT] Generando nuevas claves JWT...");
    const keys = generateJWTKeys();
    privateKey = keys.privateKey;
    publicKey = keys.publicKey;

    // Guardar claves
    writeFileSync(PRIVATE_KEY_PATH, privateKey);
    writeFileSync(PUBLIC_KEY_PATH, publicKey);
    console.log("✅ [JWT] Claves guardadas en:", KEYS_DIR);
  }

  return {
    privateKey,
    publicKey,
    algorithm: "ES256",
    expiresIn: "2h", // 2 horas (igual que la delegación)
  };
}

/**
 * Inicializa el módulo JWT
 */
export function initJWT(): void {
  jwtConfig = loadOrGenerateKeys();
  console.log("✅ [JWT] Módulo inicializado");
  console.log(`   Algoritmo: ${jwtConfig.algorithm}`);
  console.log(`   Expiración: ${jwtConfig.expiresIn}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE JWT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un JWT firmado para una sesión autorizada
 * 
 * @param payload - Datos de la sesión
 * @returns JWT firmado
 */
export function generateJWT(payload: JWTPayload): string {
  if (!jwtConfig) {
    throw new Error("JWT no inicializado. Llama a initJWT() primero.");
  }

  console.log("🎫 [JWT] Generando token para sala:", payload.salaId);

  const token = jwt.sign(payload, jwtConfig.privateKey, {
    algorithm: jwtConfig.algorithm,
    expiresIn: jwtConfig.expiresIn,
    jwtid: crypto.randomUUID(),
    issuer: "keypass-auth",
    subject: payload.salaId,
  });

  console.log("✅ [JWT] Token generado");
  console.log(`   Expira en: ${jwtConfig.expiresIn}`);
  console.log(`   Tamaño: ${token.length} caracteres`);

  return token;
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN DE JWT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica y decodifica un JWT
 * 
 * @param token - JWT a verificar
 * @returns Payload decodificado si es válido
 * @throws Error si el token es inválido o expiró
 */
export function verifyJWT(token: string): JWTPayload {
  if (!jwtConfig) {
    throw new Error("JWT no inicializado. Llama a initJWT() primero.");
  }

  console.log("🔍 [JWT] Verificando token...");

  try {
    const decoded = jwt.verify(token, jwtConfig.publicKey, {
      algorithms: [jwtConfig.algorithm],
      issuer: "keypass-auth",
    }) as JWTPayload;

    console.log("✅ [JWT] Token válido");
    console.log(`   Sala: ${decoded.salaId}`);
    console.log(`   JTI: ${decoded.jti}`);

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      console.error("❌ [JWT] Token expirado:", error.expiredAt);
      throw new Error("Token expirado");
    } else if (error instanceof jwt.JsonWebTokenError) {
      console.error("❌ [JWT] Token inválido:", error.message);
      throw new Error("Token inválido");
    } else {
      console.error("❌ [JWT] Error desconocido:", error);
      throw error;
    }
  }
}

/**
 * Decodifica un JWT sin verificar (solo para debugging)
 * 
 * @param token - JWT a decodificar
 * @returns Payload decodificado (sin verificar firma)
 */
export function decodeJWT(token: string): JWTPayload | null {
  const decoded = jwt.decode(token);
  return decoded as JWTPayload | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene la clave pública JWT (para compartir con otros servicios)
 */
export function getJWTPublicKey(): string {
  if (!jwtConfig) {
    throw new Error("JWT no inicializado. Llama a initJWT() primero.");
  }
  return jwtConfig.publicKey;
}

/**
 * Renueva las claves JWT (rotación de claves)
 */
export function rotateJWTKeys(): void {
  console.log("🔄 [JWT] Rotando claves...");
  
  const keys = generateJWTKeys();
  writeFileSync(PRIVATE_KEY_PATH, keys.privateKey);
  writeFileSync(PUBLIC_KEY_PATH, keys.publicKey);
  
  jwtConfig = {
    ...jwtConfig!,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
  };
  
  console.log("✅ [JWT] Claves rotadas exitosamente");
  console.log("⚠️  [JWT] Todos los tokens anteriores serán inválidos");
}
