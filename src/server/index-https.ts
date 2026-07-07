/**
 * SERVIDOR HTTPS/WSS PARA PRODUCCIÓN
 * 
 * Versión del servidor con soporte TLS/SSL para HTTPS y WSS.
 * Requiere certificados TLS en ./certs/ (generar con: npm run gen-certs)
 * 
 * Uso: npm run dev:https
 */

import Fastify from "fastify";
import fastifyWebSocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import fastifyCors from "@fastify/cors";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
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
import { initDatabase, obtenerEstadisticasDB, cerrarDatabase } from "./database.js";
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

const PORT = Number(process.env.PORT) || 3443;
const HOST = process.env.HOST || "0.0.0.0";

// ═══════════════════════════════════════════════════════════════════════════
// CERTIFICADOS TLS
// ═══════════════════════════════════════════════════════════════════════════

const certsDir = join(__dirname, "../../certs");
const keyPath = join(certsDir, "key.pem");
const certPath = join(certsDir, "cert.pem");

if (!existsSync(keyPath) || !existsSync(certPath)) {
  console.error("\n❌ Certificados TLS no encontrados");
  console.error(`   Esperado: ${keyPath} y ${certPath}`);
  console.error("\n📋 Generá los certificados con:");
  console.error("   npm run gen-certs\n");
  process.exit(1);
}

const tlsOptions = {
  key: readFileSync(keyPath),
  cert: readFileSync(certPath),
};

console.log("✅ Certificados TLS cargados\n");

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN DEL SERVIDOR HTTPS
// ═══════════════════════════════════════════════════════════════════════════

const server = Fastify({
  logger: {
    level: "info",
  },
  https: tlsOptions,
});

// Registrar plugins
await server.register(fastifyCors, {
  origin: true,
  methods: ["GET", "POST"],
});

await server.register(fastifyWebSocket);

// Servir archivos estáticos
const frontendDist = join(__dirname, "../../dist/frontend");
await server.register(fastifyStatic, {
  root: frontendDist,
  prefix: "/",
  decorateReply: false,
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS HTTP
// ═══════════════════════════════════════════════════════════════════════════

server.get("/api/health", async () => {
  const stats = obtenerEstadisticas();
  const dbStats = obtenerEstadisticasDB();
  return {
    status: "ok",
    servicio: "KeyPass Auth Server (HTTPS)",
    version: "2.1.0",
    timestamp: Date.now(),
    tls: true,
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

server.post<{
  Body: { paquete: DelegationResult; salaId: string };
}>("/api/verify", async (request, reply) => {
  const { paquete, salaId } = request.body;

  console.log("\n" + "═".repeat(60));
  console.log("📥 [API] POST /api/verify recibido (HTTPS)");
  console.log(`   Sala: ${salaId}`);
  console.log("═".repeat(60));

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

  const room = obtenerSala(salaId);
  if (!room) {
    return reply.status(404).send({
      valido: false,
      mensaje: `Sala ${salaId} no encontrada o ya expirada.`,
    } satisfies VerifyResponse);
  }

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

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET SECURE (WSS)
// ═══════════════════════════════════════════════════════════════════════════

server.register(async function (fastify) {
  fastify.get("/ws", { websocket: true }, (socket, request) => {
    const clientId = Math.random().toString(36).substring(2, 8);
    console.log(`\n🔌 [WSS] Nuevo cliente conectado: ${clientId}`);

    let esNotebook = true;
    let salaId: string | null = null;

    salaId = crearSala(socket as unknown as WebSocket);
    enviarSalaIdANotebook(socket as unknown as WebSocket, salaId);

    console.log(`📋 [WSS] Cliente ${clientId} es NOTEBOOK en sala ${salaId}`);

    (socket as unknown as WebSocket).on("message", (data) => {
      try {
        const mensaje = JSON.parse(data.toString()) as WSClientMessage;
        console.log(`\n📨 [WSS] Mensaje recibido de ${clientId}:`, mensaje.tipo);

        if (mensaje.tipo === "delegacion_enviar") {
          esNotebook = false;
          const { salaId: targetSalaId, paquete } = mensaje;

          console.log(`📱 [WSS] Cliente ${clientId} es CELULAR`);
          console.log(`   Target sala: ${targetSalaId}`);

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

          const retransmitido = retransmitirANotebook(targetSalaId, paquete);
          enviarAckACelular(
            socket as unknown as WebSocket,
            targetSalaId,
            retransmitido
          );
        }
      } catch (error) {
        console.error(`❌ [WSS] Error procesando mensaje de ${clientId}:`, error);
        enviarError(socket as unknown as WebSocket, "Mensaje JSON inválido");
      }
    });

    (socket as unknown as WebSocket).on("close", () => {
      console.log(`\n👋 [WSS] Cliente ${clientId} desconectado`);

      if (esNotebook) {
        limpiarNotebook(socket as unknown as WebSocket);
      } else {
        limpiarCelular(socket as unknown as WebSocket);
      }

      const stats = obtenerEstadisticas();
      console.log(`   Salas activas: ${stats.totalSalas}`);
    });

    (socket as unknown as WebSocket).on("error", (error) => {
      console.error(`❌ [WSS] Error en cliente ${clientId}:`, error);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REDIRECCIONES SPA
// ═══════════════════════════════════════════════════════════════════════════

server.get("/notebook", async (request, reply) => {
  return reply.redirect("/notebook/");
});

server.get("/mobile", async (request, reply) => {
  return reply.redirect("/mobile/");
});

// ═══════════════════════════════════════════════════════════════════════════
// INICIO DEL SERVIDOR HTTPS
// ═══════════════════════════════════════════════════════════════════════════

// Inicializar módulo JWT
initJWT();

// Inicializar base de datos
initDatabase();

setInterval(limpiarSalasInactivas, 5 * 60 * 1000);

try {
  await server.listen({ port: PORT, host: HOST });
  
  console.log("\n" + "▓".repeat(70));
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  🔐 KEYPASS AUTH SERVER v2.1.0 (HTTPS)".padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + `  🌐 Servidor: https://localhost:${PORT}`.padEnd(68) + "▓");
  console.log("▓" + `  🔌 WebSocket: wss://localhost:${PORT}/ws`.padEnd(68) + "▓");
  console.log("▓" + `  📋 API Health: https://localhost:${PORT}/api/health`.padEnd(68) + "▓");
  console.log("▓" + `  🔐 Verify API: https://localhost:${PORT}/api/verify`.padEnd(68) + "▓");
  console.log("▓" + `  📊 Stats API: https://localhost:${PORT}/api/stats`.padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  📱 Frontends:".padEnd(68) + "▓");
  console.log("▓" + `     Notebook: https://localhost:${PORT}/notebook/`.padEnd(68) + "▓");
  console.log("▓" + `     Celular:  https://localhost:${PORT}/mobile/`.padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  ⚠️  Certificado auto-firmado - El navegador mostrará advertencia".padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓".repeat(70) + "\n");
} catch (err) {
  console.error("❌ Error iniciando servidor HTTPS:", err);
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
