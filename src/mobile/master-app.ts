/**
 * APP MÓVIL MAESTRA (Celular del Usuario)
 * 
 * Este componente simula la app móvil del usuario que actúa como "llave maestra".
 * Tiene un par de claves ECDSA maestras persistidas (en producción estarían en Secure Enclave/Keystore).
 * 
 * Flujo de Delegación Criptográfica:
 * 1. Escanea el QR de la notebook y extrae la clave pública efímera
 * 2. Crea un payload de delegación con la clave pública y expiración
 * 3. Firma el payload con la clave privada maestra
 * 4. Envía el payload + firma al backend para verificación
 */

import type { JWK, DelegationPayload, DelegationResult } from "../shared/types.js";
import { bufferToHex, generateDeviceId } from "../shared/utils.js";

/**
 * Par de claves maestras del celular
 * En producción, estas claves estarían en el Secure Enclave (iOS) o Keystore (Android)
 * y NUNCA podrían ser exportadas
 */
export interface MasterKeyPair {
  clavePrivada: CryptoKey;
  clavePublica: CryptoKey;
  clavePublicaJWK: JWK;
  deviceId: string;
}

/**
 * Datos extraídos del QR escaneado
 */
export interface QRData {
  version: string;
  tipo: string;
  dispositivo_id: string;
  clave_publica: JWK;
  timestamp: number;
  metadata: {
    algoritmo: string;
    curva: string;
    proposito: string;
  };
}

/**
 * Genera o recupera el par de claves maestras del celular
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #2:
 * En producción, estas claves se generarían UNA SOLA VEZ durante el registro
 * y se almacenarían en hardware seguro (Secure Enclave/Keystore).
 * Para esta demo, las generamos en memoria.
 * 
 * @returns Par de claves maestras ECDSA P-256
 */
export async function obtenerClavesMaestras(): Promise<MasterKeyPair> {
  console.log("🔑 [MOBILE] Obteniendo claves maestras del celular...");

  // En producción: aquí se cargarían desde Secure Enclave/Keystore
  // Para demo: generamos un par nuevo
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"]
  );

  const publicKeyJWK = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const deviceId = generateDeviceId();

  console.log("✅ [MOBILE] Claves maestras obtenidas");
  console.log("   Device ID:", deviceId);
  console.log("   Clave pública X:", publicKeyJWK.x?.substring(0, 20) + "...");

  return {
    clavePrivada: keyPair.privateKey,
    clavePublica: keyPair.publicKey,
    clavePublicaJWK: publicKeyJWK as JWK,
    deviceId,
  };
}

/**
 * Escanea el QR de la notebook y extrae la clave pública efímera
 * 
 * @param qrPayload - String JSON del QR escaneado
 * @returns Datos parseados del QR incluyendo la clave pública
 */
export function escanearQR(qrPayload: string): QRData {
  console.log("📷 [MOBILE] Escaneando código QR de la notebook...");

  try {
    const qrData: QRData = JSON.parse(qrPayload);

    // Validar que sea un QR de KeyPass Auth
    if (qrData.tipo !== "keypass-auth-ephemeral") {
      throw new Error(`QR inválido: tipo '${qrData.tipo}' no soportado`);
    }

    console.log("✅ [MOBILE] QR escaneado exitosamente");
    console.log("   Dispositivo:", qrData.dispositivo_id);
    console.log("   Algoritmo:", qrData.metadata.algoritmo, qrData.metadata.curva);

    return qrData;
  } catch (error) {
    console.error("❌ [MOBILE] Error al escanear QR:", error);
    throw new Error("QR inválido o corrupto");
  }
}

/**
 * Crea el payload de delegación criptográfica
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #3:
 * Este payload es el "contrato" que autoriza a la notebook a actuar
 * en nombre del usuario. Contiene:
 * - La clave pública efímera de la notebook (autorizado)
 * - Timestamp de expiración (ventana de validez)
 * - Timestamp de emisión (para auditoría)
 * 
 * @param clavePublicaNotebook - Clave pública JWK de la notebook (del QR)
 * @param duracionHoras - Horas de validez de la delegación (default: 2)
 * @returns Payload de delegación
 */
export function crearPayloadDelegacion(
  clavePublicaNotebook: JWK,
  duracionHoras: number = 2
): DelegationPayload {
  const ahora = Date.now();
  const expiracion = ahora + duracionHoras * 60 * 60 * 1000; // 2 horas en ms

  const payload: DelegationPayload = {
    autorizado: clavePublicaNotebook,
    expiracion: expiracion,
    emitido_en: ahora,
    dispositivo_id: generateDeviceId(),
  };

  console.log("📝 [MOBILE] Payload de delegación creado");
  console.log("   Emitido:", new Date(ahora).toISOString());
  console.log("   Expira:", new Date(expiracion).toISOString());
  console.log("   Duración:", duracionHoras, "horas");

  return payload;
}

/**
 * Firma criptográficamente el payload de delegación
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #4:
 * - Serializa el payload a JSON (canónico, sin espacios)
 * - Firma los bytes UTF-8 del JSON usando ECDSA-SHA256
 * - La firma garantiza:
 *   ✓ Integridad: el payload no fue modificado
 *   ✓ Autenticidad: fue firmado por el dueño de la clave maestra
 *   ✓ No repudio: el celular no puede negar haberlo firmado
 * 
 * @param payload - Payload de delegación a firmar
 * @param clavePrivadaMaestra - Clave privada maestra del celular
 * @returns Firma en formato hexadecimal
 */
export async function firmarDelegacion(
  payload: DelegationPayload,
  clavePrivadaMaestra: CryptoKey
): Promise<string> {
  console.log("✍️  [MOBILE] Firmando payload de delegación...");

  // PASO 1: Serializar el payload a JSON canónico
  // Usamos JSON.stringify sin espacios para garantizar consistencia
  const payloadJSON = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJSON);

  console.log("   Payload size:", payloadBytes.length, "bytes");

  // PASO 2: Firmar usando ECDSA con SHA-256
  // crypto.subtle.sign retorna un ArrayBuffer con la firma DER-encoded
  const firmaBuffer = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256", // Hash function para ECDSA
    },
    clavePrivadaMaestra,
    payloadBytes
  );

  // PASO 3: Convertir la firma a hexadecimal para transmisión
  const firmaHex = bufferToHex(firmaBuffer);

  console.log("✅ [MOBILE] Payload firmado exitosamente");
  console.log("   Firma (hex):", firmaHex.substring(0, 40) + "...");
  console.log("   Firma size:", firmaHex.length, "caracteres");

  return firmaHex;
}

/**
 * Función principal de delegación criptográfica
 * Orquesta todo el flujo de la app móvil:
 * 1. Obtiene las claves maestras
 * 2. Escanea el QR de la notebook
 * 3. Crea el payload de delegación
 * 4. Firma el payload
 * 5. Retorna el paquete completo para enviar al backend
 * 
 * @param qrPayload - String JSON del QR escaneado
 * @returns Resultado completo de la delegación
 */
export async function realizarDelegacion(qrPayload: string): Promise<DelegationResult> {
  console.log("\n" + "█".repeat(60));
  console.log("█  APP MÓVIL MAESTRA - KeyPass Auth");
  console.log("█  Delegación Criptográfica");
  console.log("█".repeat(60) + "\n");

  // PASO 1: Obtener claves maestras del celular
  const clavesMaestras = await obtenerClavesMaestras();

  // PASO 2: Escanear QR de la notebook
  const qrData = escanearQR(qrPayload);

  // PASO 3: Crear payload de delegación
  const payload = crearPayloadDelegacion(qrData.clave_publica);

  // PASO 4: Firmar el payload
  const firma = await firmarDelegacion(payload, clavesMaestras.clavePrivada);

  // PASO 5: Empaquetar resultado
  const resultado: DelegationResult = {
    payload,
    firma,
    clave_publica_maestra: clavesMaestras.clavePublicaJWK,
    algoritmo: "ECDSA",
    curva: "P-256",
  };

  console.log("\n📦 [MOBILE] Paquete de delegación listo para enviar al backend");
  console.log("   Payload: ✓");
  console.log("   Firma: ✓");
  console.log("   Clave pública maestra: ✓");

  return resultado;
}

/**
 * Función principal de demostración
 */
export async function main(qrPayload: string): Promise<DelegationResult> {
  const resultado = await realizarDelegacion(qrPayload);

  console.log("\n" + "=".repeat(60));
  console.log("📤 PAQUETE ENVIADO AL BACKEND");
  console.log("=".repeat(60));
  console.log(JSON.stringify(resultado, null, 2));
  console.log("=".repeat(60) + "\n");

  return resultado;
}

// Ejecutar si se llama directamente (requiere pasar qrPayload como argumento)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.error("❌ Este script debe ejecutarse desde demo.ts");
  console.error("   Ejecutar: npm run demo");
  process.exit(1);
}
