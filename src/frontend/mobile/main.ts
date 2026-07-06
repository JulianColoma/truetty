/**
 * FRONTEND CELULAR - KeyPass Authenticator
 * 
 * Flujo:
 * 1. Cargar/generar llave maestra ECDSA P-256 (persistida en localStorage)
 * 2. Escanear QR de la notebook con la cámara
 * 3. Parsear QR → extraer clave pública efímera + salaId
 * 4. Firmar payload de delegación con la clave privada maestra
 * 5. Enviar paquete por WebSocket al servidor
 * 6. Mostrar resultado
 */

import { Html5Qrcode } from "html5-qrcode";
import type {
  JWK,
  QRPayload,
  DelegationPayload,
  DelegationResult,
  WSServerMessage,
} from "../../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// ELEMENTOS DEL DOM
// ═══════════════════════════════════════════════════════════════════════════

const elEstadoEscaneando = document.getElementById("estado-escaneando")!;
const elEstadoProcesando = document.getElementById("estado-procesando")!;
const elEstadoExito = document.getElementById("estado-exito")!;
const elEstadoError = document.getElementById("estado-error")!;
const elMasterKeyStatus = document.getElementById("master-key-status")!;
const elProcessingText = document.getElementById("processing-text")!;
const elStepScan = document.getElementById("step-scan")!;
const elStepSign = document.getElementById("step-sign")!;
const elStepSend = document.getElementById("step-send")!;
const elDeviceName = document.getElementById("device-name")!;
const elDeviceSala = document.getElementById("device-sala")!;
const elErrorText = document.getElementById("error-text")!;
const elBtnScanAgain = document.getElementById("btn-scan-again")!;

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════════════

const STORAGE_KEY = "keypass_master_key";
let clavePrivadaMaestra: CryptoKey | null = null;
let clavePublicaMaestraJWK: JWK | null = null;
let html5Qrcode: Html5Qrcode | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

function mostrarEstado(estadoId: string): void {
  document.querySelectorAll(".estado").forEach((el) => el.classList.remove("active"));
  document.getElementById(estadoId)?.classList.add("active");
}

function getWSUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function setStepStatus(step: HTMLElement, status: "pending" | "active" | "done"): void {
  step.classList.remove("active", "done");
  const icon = step.querySelector(".step-icon")!;
  if (status === "done") {
    step.classList.add("done");
    icon.textContent = "✅";
  } else if (status === "active") {
    step.classList.add("active");
    icon.textContent = "⏳";
  } else {
    icon.textContent = "⏳";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LLAVE MAESTRA (Persistencia en localStorage)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Carga la llave maestra desde localStorage o genera una nueva
 * 
 * ⚠️ NOTA DE SEGURIDAD: En producción, la clave privada NUNCA debería
 * exportarse a localStorage. Debería estar en Secure Enclave (iOS) o
 * Keystore (Android). Para este MVP, la exportamos como JWK para
 * simular la persistencia.
 */
async function cargarOGenerarLlaveMaestra(): Promise<void> {
  console.log("🔑 [MOBILE] Cargando llave maestra...");

  const stored = localStorage.getItem(STORAGE_KEY);

  if (stored) {
    // Importar llave existente
    try {
      const jwkPriv = JSON.parse(stored);
      const keyPair = await crypto.subtle.importKey(
        "jwk",
        jwkPriv,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"]
      );

      // Extraer la clave pública
      const pubKey = await crypto.subtle.exportKey("jwk", keyPair);
      // La clave importada es privada, necesitamos la pública
      // Para eso, generamos un par nuevo y comparamos... o mejor:
      // Importamos solo la parte pública
      const pubJWK: JWK = {
        kty: jwkPriv.kty,
        crv: jwkPriv.crv,
        x: jwkPriv.x,
        y: jwkPriv.y,
      };

      clavePrivadaMaestra = keyPair;
      clavePublicaMaestraJWK = pubJWK;

      console.log("✅ [MOBILE] Llave maestra cargada desde localStorage");
      updateMasterKeyStatus(true);
      return;
    } catch (error) {
      console.warn("⚠️ [MOBILE] Error importando llave, generando nueva...", error);
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // Generar nueva llave maestra
  console.log("🔐 [MOBILE] Generando nueva llave maestra ECDSA P-256...");

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  clavePrivadaMaestra = keyPair.privateKey;

  // Exportar clave privada como JWK para persistir
  // ⚠️ Solo para demo. En producción: usar Secure Enclave/Keystore
  const privateJWK = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(privateJWK));

  // Exportar clave pública
  clavePublicaMaestraJWK = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey
  )) as JWK;

  console.log("✅ [MOBILE] Llave maestra generada y persistida");
  updateMasterKeyStatus(true);
}

function updateMasterKeyStatus(ready: boolean): void {
  const indicator = elMasterKeyStatus.querySelector(".status-indicator")!;
  const text = elMasterKeyStatus.querySelector("span:last-child")!;

  if (ready) {
    indicator.classList.remove("pending");
    indicator.classList.add("ready");
    text.textContent = "Llave maestra lista ✓";
  } else {
    indicator.classList.remove("ready");
    indicator.classList.add("pending");
    text.textContent = "Verificando llave maestra...";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ESCÁNER QR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicia el escáner QR con la cámara del celular
 */
async function iniciarScanner(): Promise<void> {
  console.log("📷 [MOBILE] Iniciando escáner QR...");

  html5Qrcode = new Html5Qrcode("qr-reader");

  try {
    await html5Qrcode.start(
      { facingMode: "environment" }, // Cámara trasera
      {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      },
      onQRDetected,
      () => {
        // Callback de error por frame (no hacer nada, es normal)
      }
    );
    console.log("✅ [MOBILE] Escáner QR iniciado");
  } catch (error) {
    console.error("❌ [MOBILE] Error iniciando escáner:", error);
    mostrarError("No se pudo acceder a la cámara. Verificá los permisos.");
  }
}

/**
 * Callback cuando se detecta un QR
 */
async function onQRDetected(decodedText: string): Promise<void> {
  console.log("📱 [MOBILE] QR detectado!");

  // Detener el scanner
  if (html5Qrcode) {
    try {
      await html5Qrcode.stop();
    } catch (e) {
      console.warn("Error stopping scanner:", e);
    }
  }

  try {
    // Parsear el QR
    const qrData: QRPayload = JSON.parse(decodedText);

    // Validar que sea un QR de KeyPass
    if (qrData.tipo !== "keypass-auth-qr") {
      throw new Error(`QR inválido: tipo '${qrData.tipo}' no soportado`);
    }

    console.log("   Sala:", qrData.salaId);
    console.log("   Algoritmo:", qrData.metadata.algoritmo, qrData.metadata.curva);

    // Procesar la delegación
    await procesarDelegacion(qrData);
  } catch (error) {
    console.error("❌ [MOBILE] Error procesando QR:", error);
    mostrarError("QR inválido o corrupto. Intentá de nuevo.");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DELEGACIÓN CRIPTOGRÁFICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Procesa la delegación: firma y envía al servidor
 */
async function procesarDelegacion(qrData: QRPayload): Promise<void> {
  mostrarEstado("estado-procesando");

  // Step 1: QR escaneado ✓
  setStepStatus(elStepScan, "done");
  setStepStatus(elStepSign, "active");
  elProcessingText.textContent = "Firmando delegación criptográfica...";

  if (!clavePrivadaMaestra || !clavePublicaMaestraJWK) {
    throw new Error("Llave maestra no disponible");
  }

  // Crear payload de delegación
  const ahora = Date.now();
  const payload: DelegationPayload = {
    autorizado: qrData.clave_publica,
    expiracion: ahora + 2 * 60 * 60 * 1000, // 2 horas
    emitido_en: ahora,
  };

  // Firmar el payload
  const payloadJSON = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJSON);

  const firmaBuffer = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    clavePrivadaMaestra,
    payloadBytes
  );

  const firmaHex = bufferToHex(firmaBuffer);

  console.log("✅ [MOBILE] Payload firmado");

  // Step 2: Firma ✓
  setStepStatus(elStepSign, "done");
  setStepStatus(elStepSend, "active");
  elProcessingText.textContent = "Enviando al servidor...";

  // Construir paquete
  const paquete: DelegationResult = {
    payload,
    firma: firmaHex,
    clave_publica_maestra: clavePublicaMaestraJWK,
    algoritmo: "ECDSA",
    curva: "P-256",
  };

  // Enviar por WebSocket
  await enviarPorWebSocket(qrData.salaId, paquete);
}

/**
 * Envía el paquete de delegación al servidor por WebSocket
 */
async function enviarPorWebSocket(
  salaId: string,
  paquete: DelegationResult
): Promise<void> {
  return new Promise((resolve, reject) => {
    const wsUrl = getWSUrl();
    console.log("🔌 [MOBILE] Conectando a WebSocket:", wsUrl);

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("✅ [MOBILE] WebSocket conectado");

      // Enviar paquete de delegación
      const mensaje = {
        tipo: "delegacion_enviar",
        salaId,
        paquete,
      };

      ws.send(JSON.stringify(mensaje));
      console.log("📤 [MOBILE] Paquete enviado");
    };

    ws.onmessage = (event) => {
      try {
        const msg: WSServerMessage = JSON.parse(event.data);
        console.log("📨 [MOBILE] Respuesta:", msg.tipo);

        if (msg.tipo === "delegacion_ack") {
          if (msg.exito) {
            // Step 3: Envío ✓
            setStepStatus(elStepSend, "done");
            elProcessingText.textContent = "¡Completado!";

            // Mostrar éxito después de un breve delay
            setTimeout(() => {
              mostrarExito(salaId);
            }, 800);
          } else {
            mostrarError(msg.mensaje);
          }
          ws.close();
          resolve();
        } else if (msg.tipo === "error") {
          mostrarError(msg.mensaje);
          ws.close();
          reject(new Error(msg.mensaje));
        }
      } catch (error) {
        console.error("❌ [MOBILE] Error procesando respuesta:", error);
        ws.close();
        reject(error);
      }
    };

    ws.onerror = (error) => {
      console.error("❌ [MOBILE] Error WebSocket:", error);
      mostrarError("Error de conexión con el servidor.");
      ws.close();
      reject(error);
    };

    // Timeout de seguridad
    setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close();
        mostrarError("Timeout de conexión. Intentá de nuevo.");
        reject(new Error("Timeout"));
      }
    }, 10000);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADOS DE UI
// ═══════════════════════════════════════════════════════════════════════════

function mostrarExito(salaId: string): void {
  mostrarEstado("estado-exito");
  elDeviceName.textContent = "Notebook";
  elDeviceSala.textContent = `Sala: ${salaId}`;
}

function mostrarError(mensaje: string): void {
  mostrarEstado("estado-error");
  elErrorText.textContent = mensaje;
}

async function resetear(): Promise<void> {
  // Reset steps
  setStepStatus(elStepScan, "pending");
  setStepStatus(elStepSign, "pending");
  setStepStatus(elStepSend, "pending");

  mostrarEstado("estado-escaneando");
  await iniciarScanner();
}

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

async function init(): Promise<void> {
  console.log("\n" + "█".repeat(60));
  console.log("█  KEYPASS AUTHENTICATOR - CELULAR");
  console.log("█".repeat(60) + "\n");

  try {
    // Paso 1: Cargar/generar llave maestra
    await cargarOGenerarLlaveMaestra();

    // Paso 2: Iniciar scanner QR
    await iniciarScanner();

    console.log("✅ [MOBILE] Listo para escanear");
  } catch (error) {
    console.error("❌ [MOBILE] Error en inicialización:", error);
    mostrarError("Error inicializando la aplicación.");
  }
}

// Event listeners
elBtnScanAgain.addEventListener("click", resetear);

// Iniciar
init();
