/**
 * PRUEBA DE JWT - Verificación de tokens
 * 
 * Este script prueba el flujo completo de JWT:
 * 1. Realiza una delegación exitosa
 * 2. Obtiene el JWT del servidor
 * 3. Verifica el JWT usando el endpoint /api/verify-jwt
 */

import WebSocket from "ws";
import type {
  JWK,
  DelegationPayload,
  DelegationResult,
  WSServerMessage,
  VerifyResponse,
} from "./shared/types.js";

const SERVER_URL = "ws://localhost:3000/ws";
const API_URL = "http://localhost:3000/api/verify";
const JWT_VERIFY_URL = "http://localhost:3000/api/verify-jwt";

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULACIÓN DE NOTEBOOK
// ═══════════════════════════════════════════════════════════════════════════

async function simularNotebook(): Promise<{
  ws: WebSocket;
  salaId: string;
  clavePrivada: CryptoKey;
  clavePublicaJWK: JWK;
  delegacionRecibida: Promise<DelegationResult>;
}> {
  console.log("\n📱 [NOTEBOOK] Conectando al servidor...");

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);

    let resolveDelegacion: (value: DelegationResult) => void;
    const delegacionRecibida = new Promise<DelegationResult>((res) => {
      resolveDelegacion = res;
    });

    ws.on("open", () => {
      console.log("✅ [NOTEBOOK] WebSocket conectado");
    });

    ws.on("message", async (data) => {
      const msg: WSServerMessage = JSON.parse(data.toString());
      console.log("📨 [NOTEBOOK] Mensaje recibido:", msg.tipo);

      if (msg.tipo === "sala_asignada") {
        console.log("🏠 [NOTEBOOK] Sala asignada:", msg.salaId);

        // Generar claves efímeras
        console.log("🔐 [NOTEBOOK] Generando claves efímeras...");
        const keyPair = await crypto.subtle.generateKey(
          { name: "ECDSA", namedCurve: "P-256" },
          true,
          ["sign", "verify"]
        );

        const clavePublicaJWK = (await crypto.subtle.exportKey(
          "jwk",
          keyPair.publicKey
        )) as JWK;

        console.log("✅ [NOTEBOOK] Claves generadas");

        resolve({
          ws,
          salaId: msg.salaId,
          clavePrivada: keyPair.privateKey,
          clavePublicaJWK,
          delegacionRecibida,
        });
      } else if (msg.tipo === "delegacion_recibida") {
        console.log("📦 [NOTEBOOK] Delegación recibida del celular");
        resolveDelegacion!(msg.paquete);
      }
    });

    ws.on("error", (error) => {
      console.error("❌ [NOTEBOOK] Error:", error);
      reject(error);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMULACIÓN DE CELULAR
// ═══════════════════════════════════════════════════════════════════════════

async function simularCelular(
  salaId: string,
  clavePublicaNotebook: JWK
): Promise<void> {
  console.log("\n📱 [CELULAR] Conectando al servidor...");

  // Generar/cargar llave maestra
  console.log("🔑 [CELULAR] Generando llave maestra...");
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  const clavePublicaMaestraJWK = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey
  )) as JWK;

  console.log("✅ [CELULAR] Llave maestra generada");

  // Crear payload de delegación
  const payload: DelegationPayload = {
    autorizado: clavePublicaNotebook,
    expiracion: Date.now() + 2 * 60 * 60 * 1000, // 2 horas
    emitido_en: Date.now(),
  };

  // Firmar payload
  console.log("✍️  [CELULAR] Firmando delegación...");
  const payloadJSON = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJSON);

  const firmaBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    payloadBytes
  );

  const firmaHex = bufferToHex(firmaBuffer);
  console.log("✅ [CELULAR] Delegación firmada");

  // Construir paquete
  const paquete: DelegationResult = {
    payload,
    firma: firmaHex,
    clave_publica_maestra: clavePublicaMaestraJWK,
    algoritmo: "ECDSA",
    curva: "P-256",
  };

  // Conectar al WebSocket y enviar
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(SERVER_URL);

    ws.on("open", () => {
      console.log("✅ [CELULAR] WebSocket conectado");

      // Enviar paquete de delegación
      const mensaje = {
        tipo: "delegacion_enviar",
        salaId,
        paquete,
      };

      ws.send(JSON.stringify(mensaje));
      console.log("📤 [CELULAR] Paquete enviado");
    });

    ws.on("message", (data) => {
      const msg: WSServerMessage = JSON.parse(data.toString());
      console.log("📨 [CELULAR] Respuesta:", msg.tipo);

      if (msg.tipo === "delegacion_ack") {
        if (msg.exito) {
          console.log("✅ [CELULAR] Delegación aceptada");
          ws.close();
          resolve();
        } else {
          console.error("❌ [CELULAR] Delegación rechazada:", msg.mensaje);
          ws.close();
          reject(new Error(msg.mensaje));
        }
      }
    });

    ws.on("error", (error) => {
      console.error("❌ [CELULAR] Error:", error);
      reject(error);
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN HTTP
// ═══════════════════════════════════════════════════════════════════════════

async function verificarDelegacion(
  paquete: DelegationResult,
  salaId: string
): Promise<VerifyResponse> {
  console.log("\n🔍 [VERIFY] Enviando paquete a /api/verify...");

  const response = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paquete, salaId }),
  });

  const resultado: VerifyResponse = await response.json();
  return resultado;
}

async function verificarJWT(token: string): Promise<any> {
  console.log("\n🔍 [JWT] Verificando token en /api/verify-jwt...");

  const response = await fetch(JWT_VERIFY_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const resultado = await response.json();
  return resultado;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  console.log("\n" + "▓".repeat(70));
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  🧪 PRUEBA DE JWT - KEYPASS AUTH".padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓".repeat(70));

  try {
    // Paso 1: Notebook se conecta
    const notebook = await simularNotebook();
    console.log(`\n✅ Notebook conectada en sala: ${notebook.salaId}`);

    await sleep(500);

    // Paso 2: Celular "escanea" y envía delegación
    await simularCelular(notebook.salaId, notebook.clavePublicaJWK);

    await sleep(500);

    // Paso 3: Notebook recibe la delegación
    console.log("\n⏳ [NOTEBOOK] Esperando delegación...");
    const paquete = await notebook.delegacionRecibida;
    console.log("✅ [NOTEBOOK] Delegación recibida");

    await sleep(500);

    // Paso 4: Notebook verifica con /api/verify
    const resultado = await verificarDelegacion(paquete, notebook.salaId);

    console.log("\n" + "═".repeat(70));
    console.log("📋 RESULTADO DE LA VERIFICACIÓN");
    console.log("═".repeat(70));

    if (resultado.valido && resultado.sessionToken) {
      console.log("✅ VERIFICACIÓN EXITOSA");
      console.log("   Mensaje:", resultado.mensaje);
      console.log("   JWT:", resultado.sessionToken.substring(0, 80) + "...");
      console.log("   Expira:", new Date(resultado.expira_en!).toISOString());

      // Paso 5: Verificar el JWT
      const jwtResult = await verificarJWT(resultado.sessionToken);

      console.log("\n" + "═".repeat(70));
      console.log("📋 RESULTADO DE LA VERIFICACIÓN JWT");
      console.log("═".repeat(70));

      if (jwtResult.valido) {
        console.log("✅ JWT VÁLIDO");
        console.log("   Mensaje:", jwtResult.mensaje);
        console.log("   Payload:");
        console.log("     - Sala:", jwtResult.payload.salaId);
        console.log("     - Emitido:", new Date(jwtResult.payload.iat * 1000).toISOString());
        console.log("     - Expira:", new Date(jwtResult.payload.exp * 1000).toISOString());
        console.log("     - JTI:", jwtResult.payload.jti);
      } else {
        console.log("❌ JWT INVÁLIDO");
        console.log("   Mensaje:", jwtResult.mensaje);
      }

      console.log("═".repeat(70));

      // Limpiar
      notebook.ws.close();

      process.exit(jwtResult.valido ? 0 : 1);
    } else {
      console.log("❌ VERIFICACIÓN FALLIDA");
      console.log("   Mensaje:", resultado.mensaje);
      console.log("═".repeat(70));

      notebook.ws.close();
      process.exit(1);
    }
  } catch (error) {
    console.error("\n❌ ERROR EN LA PRUEBA:", error);
    process.exit(1);
  }
}

main();
