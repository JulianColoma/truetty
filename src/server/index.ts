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
  return {
    status: "ok",
    servicio: "KeyPass Auth Server",
    version: "2.0.0",
    timestamp: Date.now(),
    salas: stats,
  };
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

// ═══════════════════════════════════════════════════════════════════════════
// INICIO DEL SERVIDOR
// ═══════════════════════════════════════════════════════════════════════════

// Limpiar salas inactivas cada 5 minutos
setInterval(limpiarSalasInactivas, 5 * 60 * 1000);

try {
  await server.listen({ port: PORT, host: HOST });
  
  console.log("\n" + "▓".repeat(70));
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  🚀 KEYPASS AUTH SERVER v2.0.0".padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + `  🌐 Servidor: http://localhost:${PORT}`.padEnd(68) + "▓");
  console.log("▓" + `  🔌 WebSocket: ws://localhost:${PORT}/ws`.padEnd(68) + "▓");
  console.log("▓" + `  📋 API Health: http://localhost:${PORT}/api/health`.padEnd(68) + "▓");
  console.log("▓" + `  🔐 Verify API: http://localhost:${PORT}/api/verify`.padEnd(68) + "▓");
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
