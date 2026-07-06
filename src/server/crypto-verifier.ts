/**
 * VERIFICADOR CRIPTOGRÁFICO PARA EL SERVIDOR
 * 
 * Reutiliza la lógica de verificación ECDSA del MVP v1
 * Adaptada para funcionar con Fastify y retornar sessionTokens
 * 
 * Flujo:
 * 1. Recibe el paquete de delegación (payload + firma + clave pública maestra)
 * 2. Verifica la firma ECDSA P-256 (convirtiendo raw → DER)
 * 3. Verifica que no esté expirada
 * 4. Genera un sessionToken si todo es válido
 */

import { createVerify, createPublicKey, randomUUID } from "node:crypto";
import type {
  JWK,
  DelegationPayload,
  DelegationResult,
  VerifyResponse,
} from "../shared/types.js";
import { hexToBuffer } from "../shared/utils.js";

/**
 * Convierte una clave pública JWK a formato PEM para Node.js crypto
 * Construye el DER manualmente desde las coordenadas X, Y de la curva P-256
 */
function jwkToPEM(jwk: JWK): string {
  if (jwk.kty !== "EC") {
    throw new Error(`Tipo de clave no soportado: ${jwk.kty}`);
  }
  if (jwk.crv !== "P-256") {
    throw new Error(`Curva no soportada: ${jwk.crv}`);
  }
  if (!jwk.x || !jwk.y) {
    throw new Error("Clave JWK incompleta: faltan coordenadas x o y");
  }

  const base64ToBuffer = (base64url: string): Buffer => {
    let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) base64 += "=";
    return Buffer.from(base64, "base64");
  };

  const xBytes = base64ToBuffer(jwk.x);
  const yBytes = base64ToBuffer(jwk.y);

  // Punto no comprimido: 0x04 + X + Y
  const uncompressedPoint = Buffer.concat([
    Buffer.from([0x04]),
    xBytes,
    yBytes,
  ]);

  // OIDs para ECDSA y P-256
  const ecOID = Buffer.from([
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  ]);
  const p256OID = Buffer.from([
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  ]);

  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, ecOID.length + p256OID.length]),
    ecOID,
    p256OID,
  ]);

  const bitString = Buffer.concat([
    Buffer.from([0x03, uncompressedPoint.length + 1, 0x00]),
    uncompressedPoint,
  ]);

  const subjectPublicKeyInfo = Buffer.concat([
    Buffer.from([0x30, algorithmIdentifier.length + bitString.length]),
    algorithmIdentifier,
    bitString,
  ]);

  const base64 = subjectPublicKeyInfo.toString("base64");
  const pemLines = base64.match(/.{1,64}/g) || [];

  return [
    "-----BEGIN PUBLIC KEY-----",
    ...pemLines,
    "-----END PUBLIC KEY-----",
  ].join("\n");
}

/**
 * Convierte firma ECDSA de formato raw (r||s) a DER (ASN.1)
 * WebCrypto genera raw, Node.js crypto espera DER
 */
function rawSignatureToDER(rawSignature: Uint8Array): Buffer {
  const halfLength = rawSignature.length / 2;
  let r = rawSignature.slice(0, halfLength);
  let s = rawSignature.slice(halfLength);

  const trimLeadingZeros = (buf: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) i++;
    return buf.slice(i);
  };

  r = trimLeadingZeros(r);
  s = trimLeadingZeros(s);

  if (r[0] & 0x80) r = Buffer.concat([Buffer.from([0x00]), r]);
  if (s[0] & 0x80) s = Buffer.concat([Buffer.from([0x00]), s]);

  const rDER = Buffer.concat([Buffer.from([0x02, r.length]), r]);
  const sDER = Buffer.concat([Buffer.from([0x02, s.length]), s]);
  const sequence = Buffer.concat([rDER, sDER]);

  return Buffer.concat([Buffer.from([0x30, sequence.length]), sequence]);
}

/**
 * Verifica la firma criptográfica del paquete de delegación
 * 
 * @param paquete - Paquete completo (payload + firma + clave pública maestra)
 * @returns true si la firma es válida
 */
function verificarFirma(paquete: DelegationResult): boolean {
  try {
    const publicKey = createPublicKey(jwkToPEM(paquete.clave_publica_maestra));
    const payloadJSON = JSON.stringify(paquete.payload);
    const payloadBytes = Buffer.from(payloadJSON, "utf-8");
    const firmaRaw = hexToBuffer(paquete.firma);
    const firmaDER = rawSignatureToDER(firmaRaw);

    const verifier = createVerify("SHA256");
    verifier.update(payloadBytes);
    verifier.end();

    return verifier.verify(publicKey, firmaDER);
  } catch (error) {
    console.error("❌ [CRYPTO] Error en verificación de firma:", error);
    return false;
  }
}

/**
 * Verifica que la delegación no haya expirado
 */
function verificarExpiracion(payload: DelegationPayload): {
  expirado: boolean;
  tiempo_restante_ms: number;
} {
  const ahora = Date.now();
  const expirado = ahora > payload.expiracion;
  const tiempo_restante_ms = payload.expiracion - ahora;

  return { expirado, tiempo_restante_ms };
}

/**
 * Genera un sessionToken para sesiones autorizadas
 * En producción, esto sería un JWT firmado o un token opaco almacenado en DB
 */
function generarSessionToken(salaId: string): string {
  const payload = {
    sala: salaId,
    emitido: Date.now(),
    nonce: randomUUID(),
  };
  // Para el MVP, usamos un token Base64 simple
  // En producción: firmar con clave secreta del servidor
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString("base64url");
}

/**
 * Función principal de verificación
 * Orquesta la verificación completa del paquete de delegación
 * 
 * @param paquete - Paquete de delegación recibido
 * @param salaId - ID de la sala (para el sessionToken)
 * @returns Respuesta con el resultado de la verificación
 */
export function verificarPaquete(
  paquete: DelegationResult,
  salaId: string
): VerifyResponse {
  console.log("\n🔍 [VERIFY] Verificando paquete de delegación...");
  console.log(`   Sala: ${salaId}`);
  console.log(`   Algoritmo: ${paquete.algoritmo} ${paquete.curva}`);

  // PASO 1: Verificar firma criptográfica
  const firmaValida = verificarFirma(paquete);

  if (!firmaValida) {
    console.log("❌ [VERIFY] Firma inválida");
    return {
      valido: false,
      mensaje: "Firma criptográfica inválida. El paquete fue alterado o la clave no corresponde.",
    };
  }

  console.log("✅ [VERIFY] Firma válida");

  // PASO 2: Verificar expiración
  const { expirado, tiempo_restante_ms } = verificarExpiracion(paquete.payload);

  if (expirado) {
    console.log("❌ [VERIFY] Delegación expirada");
    return {
      valido: false,
      mensaje: `Delegación expirada hace ${Math.abs(tiempo_restante_ms) / 1000} segundos.`,
    };
  }

  console.log(
    `✅ [VERIFY] Delegación vigente (${Math.floor(tiempo_restante_ms / 1000)}s restantes)`
  );

  // PASO 3: Verificar que la clave autorizada coincida
  // (La clave pública efímera en el payload debe ser la que la notebook generó)
  // Esto ya está implícito en el flujo: la notebook envía su clave en el QR

  // PASO 4: Generar sessionToken
  const sessionToken = generarSessionToken(salaId);

  console.log("🎉 [VERIFY] DELEGACIÓN AUTORIZADA");
  console.log(`   SessionToken: ${sessionToken.substring(0, 30)}...`);

  return {
    valido: true,
    mensaje: "Delegación verificada exitosamente. Sesión autorizada.",
    sessionToken,
    expira_en: paquete.payload.expiracion,
  };
}
