/**
 * SERVIDOR PRINCIPAL KEYPASS AUTH
 * 
 * Servidor Fastify que integra:
 * 1. WebSocket para comunicación en tiempo real Notebook ↔ Celular
 * 2. Endpoint HTTP POST /api/verify para verificación criptográfica
 * 3. Servidor de archivos estáticos para los frontends
 * 
 * Arquitectura:
 * - Puerto 3000: Servidor HTTP (API + Frontends)
 * - WebSocket: ws://localhost:3000/ws
 * - Notebook: http://localhost:3000/notebook/
 * - Celular: http://localhost:3000/mobile/
 */

import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { WebSocket } from "ws";

import {
  crearSala,
  obtenerSala,
  registrarCelularEnSala,
  retransmitirANotebook,
  enviarAckACelular,
  enviarSalaIdANotebook,
  enviarError,
  limpiarNotebook,
  limpiarCelular,
  obtenerEstadisticas,
  limpiarSalasInactivas,
} from "./rooms.js";
import { verificarPaquete } from "./crypto-verifier.js";
import { initJWT } from "./jwt.js";
import { initDatabase, obtenerEstadisticasDB, cerrarDatabase, crearApp, obtenerAppsPorDeveloper } from "./database.js";
import { v4 as uuidv4 } from "uuid";
import type {
  WSClientMessage,
  DelegationResult,
  VerifyResponse,
} from "../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN DEL SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════

const server = Fastify({
  logger: {
    level: "info",
  },
});

// Registrar plugins
await server.register(fastifyCors, {
  origin: true, // Permitir todos los orígenes (en producción, restringir)
  methods: ["GET", "POST"],
});

await server.register(fastifyWebSocket);

// Servir archivos estáticos del frontend (generados por Vite)
const frontendDist = join(__dirname, "../../dist/frontend");
await server.register(fastifyStatic, {
  root: frontendDist,
  prefix: "/",
  decorateReply: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS HTTP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Health check
 */
server.get("/api/health", async () => {
  const stats = obtenerEstadisticas();
  const dbStats = obtenerEstadisticasDB();
  return {
    status: "ok",
    servicio: "KeyPass Auth Server",
    version: "2.1.0",
    timestamp: Date.now(),
    salas: stats,
    database: dbStats,
  };
});

/**
 * GET /api/stats
 * 
 * Endpoint para obtener estadísticas detalladas de la base de datos
 */
server.get("/api/stats", async () => {
  const dbStats = obtenerEstadisticasDB();
  return {
    status: "ok",
    timestamp: Date.now(),
    estadisticas: dbStats,
  };
});

/**
 * POST /api/apps
 * 
 * Endpoint para registrar una nueva aplicación.
 * Genera un client_id único y lo asocia al desarrollador.
 */
server.post<{
  Body: { nombre: string; descripcion?: string; developer_id: string };
}>("/api/apps", async (request, reply) => {
  const { nombre, descripcion, developer_id } = request.body;

  console.log("\n" + "═".repeat(60));
  console.log("📥 [API] POST /api/apps recibido");
  console.log(`   Nombre: ${nombre}`);
  console.log(`   Developer: ${developer_id}`);
  console.log("═".repeat(60));

  // Validar campos requeridos
  if (!nombre || !developer_id) {
    return reply.status(400).send({
      valido: false,
      mensaje: "Body inválido. Se requiere 'nombre' y 'developer_id'.",
    });
  }

  // Generar IDs únicos
  const id = uuidv4();
  const client_id = uuidv4();
  const ahora = Date.now();

  // Crear aplicación
  try {
    crearApp({
      id,
      client_id,
      nombre,
      descripcion: descripcion || null,
      developer_id,
      estado: "activa",
      creado_en: ahora,
      actualizado_en: ahora,
    });

    console.log(`✅ [API] Aplicación creada: ${client_id}`);

    return reply.status(201).send({
      valido: true,
      mensaje: "Aplicación creada exitosamente",
      app: {
        id,
        client_id,
        nombre,
        descripcion,
        developer_id,
        estado: "activa",
        creado_en: ahora,
        actualizado_en: ahora,
      },
    });
  } catch (error) {
    console.error("❌ [API] Error creando aplicación:", error);
    return reply.status(500).send({
      valido: false,
      mensaje: "Error interno del servidor",
    });
  }
});

/**
 * GET /api/apps
 * 
 * Endpoint para listar todas las aplicaciones de un desarrollador.
 * Requiere query param: developer_id
 */
server.get<{
  Querystring: { developer_id: string };
}>("/api/apps", async (request, reply) => {
  const { developer_id } = request.query;

  console.log("\n" + "═".repeat(60));
  console.log("📥 [API] GET /api/apps recibido");
  console.log(`   Developer: ${developer_id}`);
  console.log("═".repeat(60));

  // Validar campo requerido
  if (!developer_id) {
    return reply.status(400).send({
      valido: false,
      mensaje: "Query param 'developer_id' es requerido.",
    });
  }

  try {
    const apps = obtenerAppsPorDeveloper(developer_id);

    console.log(`✅ [API] ${apps.length} aplicaciones encontradas`);

    return reply.status(200).send({
      status: "ok",
      timestamp: Date.now(),
      total: apps.length,
      apps: apps.map((app) => ({
        id: app.id,
        client_id: app.client_id,
        nombre: app.nombre,
        descripcion: app.descripcion,
        estado: app.estado,
        creado_en: app.creado_en,
        actualizado_en: app.actualizado_en,
      })),
    });
  } catch (error) {
    console.error("❌ [API] Error obteniendo aplicaciones:", error);
    return reply.status(500).send({
      valido: false,
      mensaje: "Error interno del servidor",
    });
  }
});

/**
 * POST /api/verify
 * 
 * Endpoint de verificación criptográfica.
 * Recibe el paquete de delegación de la notebook y verifica:
 * 1. Firma ECDSA P-256 válida
 * 2. Delegación no expirada
 * 3. Retorna sessionToken si todo es válido
 */
server.post<{
  Body: { paquete: DelegationResult; salaId: string };
}>("/api/verify", async (request, reply) => {
  const { paquete, salaId } = request.body;

  console.log("\n" + "═".repeat(60));
  console.log("📥 [API] POST /api/verify recibido");
  console.log(`   Sala: ${salaId}`);
  console.log("═".repeat(60));

  // Validar que el body tenga los campos requeridos
  if (!paquete || !salaId) {
    return reply.status(400).send({
      valido: false,
      mensaje: "Body inválido. Se requiere 'paquete' y 'salaId'.",
    } satisfies VerifyResponse);
  }

  if (!paquete.payload || !paquete.firma || !paquete.clave_publica_maestra) {
    return reply.status(400).send({
      valido: false,
      mensaje: "Paquete incompleto. Falta payload, firma o clave pública maestra.",
    } satisfies VerifyResponse);
  }

  // Verificar que la sala exista
  const room = obtenerSala(salaId);
  if (!room) {
    return reply.status(404).send({
      valido: false,
      mensaje: `Sala ${salaId} no encontrada o ya expirada.`,
    } satisfies VerifyResponse);
  }

  // Verificar el paquete
  const resultado = verificarPaquete(paquete, salaId);

  if (resultado.valido) {
    return reply.status(200).send(resultado);
  } else {
    return reply.status(401).send(resultado);
  }
});

/**
 * GET /api/verify-jwt
 * 
 * Endpoint para verificar un JWT.
 * Recibe un token en el header Authorization: Bearer <token>
 * Retorna el payload decodificado si el token es válido
 */
server.get<{
  Headers: { authorization?: string };
}>("/api/verify-jwt", async (request, reply) => {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return reply.status(401).send({
      valido: false,
      mensaje: "Token no proporcionado. Use header Authorization: Bearer <token>",
    });
  }

  const token = authHeader.substring(7); // Remover "Bearer "

  try {
    const { verifyJWT } = await import("./jwt.js");
    const payload = verifyJWT(token);

    return reply.status(200).send({
      valido: true,
      mensaje: "Token válido",
      payload,
    });
  } catch (error) {
    return reply.status(401).send({
      valido: false,
      mensaje: error instanceof Error ? error.message : "Token inválido",
    });
  }
});

/**
 * POST /api/revoke
 * 
 * Endpoint para revocar una sesión por su ID.
 * Marca la sesión como "revocada" en la base de datos.
 */
server.post<{
  Body: { sessionId: string };
}>("/api/revoke", async (request, reply) => {
  const { sessionId } = request.body;

  if (!sessionId) {
    return reply.status(400).send({
      valido: false,
      mensaje: "sessionId es requerido",
    });
  }

  console.log(`\n🚫 [API] Revocando sesión: ${sessionId}`);

  const { revocarSesion, obtenerSesion, registrarAuditLog } = await import("./database.js");
  
  // Verificar que la sesión exista
  const session = obtenerSesion(sessionId);
  if (!session) {
    return reply.status(404).send({
      valido: false,
      mensaje: "Sesión no encontrada",
    });
  }

  if (session.estado !== "activa") {
    return reply.status(400).send({
      valido: false,
      mensaje: `La sesión ya está ${session.estado}`,
    });
  }

  // Revocar la sesión
  const revocado = revocarSesion(sessionId);

  if (revocado) {
    // Registrar en auditoría
    registrarAuditLog({
      evento: "sesion_revocada",
      salaId: session.salaId,
      sessionId,
      detalles: JSON.stringify({
        motivo: "revocación_manual",
        revocado_en: Date.now(),
      }),
      timestamp: Date.now(),
    });

    console.log(`✅ [API] Sesión revocada exitosamente`);
    return reply.status(200).send({
      valido: true,
      mensaje: "Sesión revocada exitosamente",
      sessionId,
      revocado_en: Date.now(),
    });
  } else {
    return reply.status(500).send({
      valido: false,
      mensaje: "Error al revocar la sesión",
    });
  }
});

/**
 * POST /api/revoke-by-sala
 * 
 * Endpoint para revocar todas las sesiones activas de una sala.
 * Útil para cerrar todas las sesiones de un dispositivo específico.
 */
server.post<{
  Body: { salaId: string };
}>("/api/revoke-by-sala", async (request, reply) => {
  const { salaId } = request.body;

  if (!salaId) {
    return reply.status(400).send({
      valido: false,
      mensaje: "salaId es requerido",
    });
  }

  console.log(`\n🚫 [API] Revocando sesiones de sala: ${salaId}`);

  const { obtenerSesionPorSala, revocarSesion, registrarAuditLog } = await import("./database.js");
  
  // Buscar sesión activa de la sala
  const session = obtenerSesionPorSala(salaId);
  
  if (!session) {
    return reply.status(404).send({
      valido: false,
      mensaje: "No hay sesiones activas para esta sala",
    });
  }

  // Revocar la sesión
  const revocado = revocarSesion(session.id);

  if (revocado) {
    // Registrar en auditoría
    registrarAuditLog({
      evento: "sesion_revocada_por_sala",
      salaId,
      sessionId: session.id,
      detalles: JSON.stringify({
        motivo: "revocación_por_sala",
        revocado_en: Date.now(),
      }),
      timestamp: Date.now(),
    });

    console.log(`✅ [API] Sesión de sala revocada exitosamente`);
    return reply.status(200).send({
      valido: true,
      mensaje: "Sesiones de la sala revocadas exitosamente",
      salaId,
      sessionId: session.id,
      revocado_en: Date.now(),
    });
  } else {
    return reply.status(500).send({
      valido: false,
      mensaje: "Error al revocar las sesiones",
    });
  }
});

/**
 * GET /api/sessions
 * 
 * Endpoint para listar todas las sesiones activas.
 */
server.get("/api/sessions", async () => {
  const { obtenerSesionesActivas } = await import("./database.js");
  const sessions = obtenerSesionesActivas();

  return {
    status: "ok",
    timestamp: Date.now(),
    total: sessions.length,
    sesiones: sessions.map((s) => ({
      id: s.id,
      salaId: s.salaId,
      estado: s.estado,
      creado_en: s.creado_en,
      expira_en: s.expira_en,
      dispositivo_id: s.dispositivo_id,
    })),
  };
});

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WebSocket endpoint: /ws
 * 
 * Flujo:
 * 1. Cliente se conecta → servidor determina si es notebook o celular
 * 2. Si es el primer cliente en una sala nueva → es notebook → se crea sala
 * 3. Si envía mensaje con salaId → es celular → se registra y retransmite
 */
server.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (socket, request) => {
    const clientId = Math.random().toString(36).substring(2, 8);
    console.log(`\n🔌 [WS] Nuevo cliente conectado: ${clientId}`);

    // Por defecto, asumimos que es una notebook (crea nueva sala)
    // El celular se identifica enviando un mensaje con salaId
    let esNotebook = true;
    let salaId: string | null = null;

    // Crear sala para la notebook
    salaId = crearSala(socket as unknown as WebSocket);
    enviarSalaIdANotebook(socket as unknown as WebSocket, salaId);

    console.log(`📋 [WS] Cliente ${clientId} es NOTEBOOK en sala ${salaId}`);

    // Manejar mensajes del cliente
    (socket as unknown as WebSocket).on("message", (data) => {
      try {
        const mensaje = JSON.parse(data.toString()) as WSClientMessage;
        console.log(`\n📨 [WS] Mensaje recibido de ${clientId}:`, mensaje.tipo);

        if (mensaje.tipo === "delegacion_enviar") {
          // Este cliente es un CELULAR enviando una delegación
          esNotebook = false;
          const { salaId: targetSalaId, paquete } = mensaje;

          console.log(`📱 [WS] Cliente ${clientId} es CELULAR`);
          console.log(`   Target sala: ${targetSalaId}`);

          // Registrar celular en la sala
          const registrado = registrarCelularEnSala(
            targetSalaId,
            socket as unknown as WebSocket
          );

          if (!registrado) {
            enviarError(
              socket as unknown as WebSocket,
              `Sala ${targetSalaId} no encontrada`
            );
            return;
          }

          // Retransmitir a la notebook
          const retransmitido = retransmitirANotebook(targetSalaId, paquete);

          // Enviar ACK al celular
          enviarAckACelular(
            socket as unknown as WebSocket,
            targetSalaId,
            retransmitido
          );
        }
      } catch (error) {
        console.error(`❌ [WS] Error procesando mensaje de ${clientId}:`, error);
        enviarError(socket as unknown as WebSocket, "Mensaje JSON inválido");
      }
    });

    // Manejar desconexión
    (socket as unknown as WebSocket).on("close", () => {
      console.log(`\n👋 [WS] Cliente ${clientId} desconectado`);

      if (esNotebook) {
        limpiarNotebook(socket as unknown as WebSocket);
      } else {
        limpiarCelular(socket as unknown as WebSocket);
      }

      const stats = obtenerEstadisticas();
      console.log(`   Salas activas: ${stats.totalSalas}`);
    });

    // Manejar errores
    (socket as unknown as WebSocket).on("error", (error) => {
      console.error(`❌ [WS] Error en cliente ${clientId}:`, error);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK PARA SPA (Single Page Application)
// ═══════════════════════════════════════════════════════════════════════════

// Redirigir rutas de frontends a sus index.html
server.get("/notebook", async (request, reply) => {
  return reply.redirect("/notebook/");
});

server.get("/mobile", async (request, reply) => {
  return reply.redirect("/mobile/");
});

server.get("/admin", async (request, reply) => {
  return reply.redirect("/admin/");
});

// ═══════════════════════════════════════════════════════════════════════════
// INICIO DEL SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════

// Inicializar módulo JWT
initJWT();

// Inicializar base de datos
initDatabase();

// Limpiar salas inactivas cada 5 minutos
setInterval(limpiarSalasInactivas, 5 * 60 * 1000);

try {
  await server.listen({ port: PORT, host: HOST });
  
  console.log("\n" + "▓".repeat(70));
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  🚀 KEYPASS AUTH SERVER v2.1.0".padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + `  🌐 Servidor: http://localhost:${PORT}`.padEnd(68) + "▓");
  console.log("▓" + `  🔌 WebSocket: ws://localhost:${PORT}/ws`.padEnd(68) + "▓");
  console.log("▓" + `  📋 API Health: http://localhost:${PORT}/api/health`.padEnd(68) + "▓");
  console.log("▓" + `  🔐 Verify API: http://localhost:${PORT}/api/verify`.padEnd(68) + "▓");
  console.log("▓" + `  📊 Stats API: http://localhost:${PORT}/api/stats`.padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  📱 Frontends:".padEnd(68) + "▓");
  console.log("▓" + `     Notebook: http://localhost:${PORT}/notebook/`.padEnd(68) + "▓");
  console.log("▓" + `     Celular:  http://localhost:${PORT}/mobile/`.padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓".repeat(70) + "\n");
} catch (err) {
  console.error("❌ Error iniciando servidor:", err);
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// MANEJO DE CIERRE
// ═══════════════════════════════════════════════════════════════════════════

// Cerrar base de datos al terminar el proceso
process.on("SIGINT", () => {
  console.log("\n🛑 Cerrando servidor...");
  cerrarDatabase();
  process.exit(0);
});

process.on("SIGTERM", () => {
  cerrarDatabase();
  process.exit(0);
});
