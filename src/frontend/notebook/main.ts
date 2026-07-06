/**
 * FRONTEND NOTEBOOK - KeyPass Auth
 * 
 * Flujo:
 * 1. Conectar al WebSocket y recibir salaId
 * 2. Generar claves efímeras ECDSA P-256
 * 3. Renderizar QR con clave pública + salaId
 * 4. Escuchar delegación del celular por WebSocket
 * 5. Verificar con POST /api/verify
 * 6. Mostrar resultado
 */

import QRCode from "qrcode";
import type {
  JWK,
  QRPayload,
  DelegationResult,
  WSServerMessage,
  VerifyResponse,
} from "../../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// ELEMENTOS DEL DOM
// ═══════════════════════════════════════════════════════════════════════════

const elEstadoConectando = document.getElementById("estado-conectando")!;
const elEstadoEsperando = document.getElementById("estado-esperando")!;
const elEstadoVerificando = document.getElementById("estado-verificando")!;
const elEstadoAutorizado = document.getElementById("estado-autorizado")!;
const elEstadoError = document.getElementById("estado-error")!;
const elQRCode = document.getElementById("qr-code")!;
const elSalaId = document.getElementById("sala-id")!;
const elSessionToken = document.getElementById("session-token")!;
const elSessionDetails = document.getElementById("session-details")!;
const elErrorMessage = document.getElementById("error-message")!;
const elBtnReintentar = document.getElementById("btn-reintentar")!;

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════════════

let ws: WebSocket | null = null;
let salaId: string | null = null;
let clavePrivadaEfimera: CryptoKey | null = null;
let clavePublicaEfimeraJWK: JWK | null = null;

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Muestra un estado específico y oculta los demás
 */
function mostrarEstado(estadoId: string): void {
  const estados = document.querySelectorAll(".estado");
  estados.forEach((el) => el.classList.remove("active"));
  document.getElementById(estadoId)?.classList.add("active");
}

/**
 * Obtiene la URL del servidor WebSocket
 * En desarrollo usa el proxy de Vite, en producción usa el mismo host
 */
function getWSUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host; // Incluye puerto si existe
  return `${protocol}//${host}/ws`;
}

/**
 * Obtiene la URL base del servidor HTTP
 */
function getApiUrl(): string {
  return `${window.location.protocol}//${window.location.host}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE CLAVES EFÍMERAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un par de claves efímeras ECDSA P-256
 */
async function generarClavesEfimeras(): Promise<void> {
  console.log("🔐 [NOTEBOOK] Generando claves efímeras ECDSA P-256...");

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );

  clavePrivadaEfimera = keyPair.privateKey;
  clavePublicaEfimeraJWK = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey
  )) as JWK;

  console.log("✅ [NOTEBOOK] Claves efímeras generadas");
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE QR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera y renderiza el código QR con la clave pública y salaId
 */
async function generarQR(): Promise<void> {
  if (!salaId || !clavePublicaEfimeraJWK) {
    throw new Error("salaId o clave pública no disponibles");
  }

  const qrPayload: QRPayload = {
    version: "2.0",
    tipo: "keypass-auth-qr",
    salaId: salaId,
    clave_publica: clavePublicaEfimeraJWK,
    timestamp: Date.now(),
    metadata: {
      algoritmo: "ECDSA",
      curva: "P-256",
      proposito: "autenticacion-delegada",
      servidor_ws: getWSUrl(),
    },
  };

  const qrString = JSON.stringify(qrPayload);
  console.log("📱 [NOTEBOOK] Generando QR...");
  console.log("   Payload size:", qrString.length, "caracteres");

  // Renderizar QR en el contenedor
  await QRCode.toCanvas(elQRCode, qrString, {
    width: 280,
    margin: 2,
    color: {
      dark: "#000000",
      light: "#ffffff",
    },
  });

  elSalaId.textContent = salaId;
  console.log("✅ [NOTEBOOK] QR renderizado");
}

// ═══════════════════════════════════════════════════════════════════════════
// WEBSOCKET
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Conecta al servidor WebSocket
 */
function conectarWebSocket(): Promise<string> {
  return new Promise((resolve, reject) => {
    const wsUrl = getWSUrl();
    console.log("🔌 [NOTEBOOK] Conectando a WebSocket:", wsUrl);

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("✅ [NOTEBOOK] WebSocket conectado");
    };

    ws.onmessage = (event) => {
      try {
        const mensaje: WSServerMessage = JSON.parse(event.data);
        console.log("📨 [NOTEBOOK] Mensaje recibido:", mensaje.tipo);

        switch (mensaje.tipo) {
          case "sala_asignada":
            salaId = mensaje.salaId;
            console.log("🏠 [NOTEBOOK] Sala asignada:", salaId);
            resolve(salaId);
            break;

          case "delegacion_recibida":
            console.log("📦 [NOTEBOOK] Delegación recibida del celular");
            manejarDelegacion(mensaje.paquete);
            break;

          case "error":
            console.error("❌ [NOTEBOOK] Error del servidor:", mensaje.mensaje);
            mostrarError(mensaje.mensaje);
            break;
        }
      } catch (error) {
        console.error("❌ [NOTEBOOK] Error procesando mensaje:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("❌ [NOTEBOOK] Error en WebSocket:", error);
      reject(new Error("Error de conexión WebSocket"));
    };

    ws.onclose = () => {
      console.log("👋 [NOTEBOOK] WebSocket cerrado");
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maneja la delegación recibida del celular
 * Envía el paquete al backend para verificación
 */
async function manejarDelegacion(paquete: DelegationResult): Promise<void> {
  console.log("🔍 [NOTEBOOK] Verificando delegación...");
  mostrarEstado("estado-verificando");

  try {
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/api/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paquete,
        salaId: salaId,
      }),
    });

    const resultado: VerifyResponse = await response.json();
    console.log("📋 [NOTEBOOK] Resultado:", resultado);

    if (resultado.valido && resultado.sessionToken) {
      mostrarExito(resultado, paquete);
    } else {
      mostrarError(resultado.mensaje);
    }
  } catch (error) {
    console.error("❌ [NOTEBOOK] Error en verificación:", error);
    mostrarError("Error de conexión con el servidor de verificación.");
  }
}

/**
 * Muestra el estado de éxito con los detalles de la sesión
 */
function mostrarExito(resultado: VerifyResponse, paquete: DelegationResult): void {
  mostrarEstado("estado-autorizado");

  elSessionToken.textContent = resultado.sessionToken || "-";

  // Detalles de la sesión
  const detalles = [
    { label: "Sala", value: salaId || "-" },
    { label: "Algoritmo", value: `${paquete.algoritmo} ${paquete.curva}` },
    {
      label: "Emitido",
      value: new Date(paquete.payload.emitido_en).toLocaleString(),
    },
    {
      label: "Expira",
      value: new Date(paquete.payload.expiracion).toLocaleString(),
    },
    {
      label: "Dispositivo",
      value: paquete.payload.dispositivo_id?.substring(0, 8) + "..." || "-",
    },
  ];

  elSessionDetails.innerHTML = detalles
    .map(
      (d) => `<li><span>${d.label}</span><span>${d.value}</span></li>`
    )
    .join("");
}

/**
 * Muestra el estado de error
 */
function mostrarError(mensaje: string): void {
  mostrarEstado("estado-error");
  elErrorMessage.textContent = mensaje;
}

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicializa la aplicación de la notebook
 */
async function init(): Promise<void> {
  console.log("\n" + "█".repeat(60));
  console.log("█  KEYPASS AUTH - NOTEBOOK");
  console.log("█".repeat(60) + "\n");

  try {
    // Paso 1: Conectar WebSocket y obtener salaId
    mostrarEstado("estado-conectando");
    await conectarWebSocket();

    // Paso 2: Generar claves efímeras
    await generarClavesEfimeras();

    // Paso 3: Generar y mostrar QR
    await generarQR();

    // Paso 4: Mostrar estado de espera
    mostrarEstado("estado-esperando");

    console.log("✅ [NOTEBOOK] Listo, esperando escaneo del celular...");
  } catch (error) {
    console.error("❌ [NOTEBOOK] Error en inicialización:", error);
    mostrarError("No se pudo conectar al servidor. Verificá que el servidor esté corriendo.");
  }
}

// Event listeners
elBtnReintentar.addEventListener("click", () => {
  window.location.reload();
});

// Iniciar
init();
