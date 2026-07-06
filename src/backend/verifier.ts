/**
 * VERIFICADOR BACKEND (Lambda / Servidor del Cliente)
 * 
 * Este componente simula el backend que verifica la delegación criptográfica.
 * Usa el módulo 'crypto' nativo de Node.js para verificar la firma ECDSA.
 * 
 * Flujo de Verificación:
 * 1. Recibe el payload, la firma y la clave pública maestra
 * 2. Importa la clave pública maestra desde JWK
 * 3. Reconstruye el payload original (mismo JSON canónico)
 * 4. Verifica matemáticamente que la firma sea válida
 * 5. Verifica que la delegación no haya expirado
 * 6. Retorna el resultado de la verificación
 */

import { createVerify, createPublicKey } from "node:crypto";
import type { JWK, DelegationPayload, DelegationResult, VerificationResult } from "../shared/types.js";
import { hexToBuffer } from "../shared/utils.js";

/**
 * Convierte una clave pública JWK a formato PEM para Node.js crypto
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #5:
 * Node.js crypto necesita la clave en formato PEM (Base64 con headers)
 * Para ECDSA P-256, construimos el DER manualmente desde las coordenadas X, Y
 * 
 * @param jwk - Clave pública en formato JWK
 * @returns Clave pública en formato PEM
 */
function jwkToPEM(jwk: JWK): string {
  // Validar que sea una clave EC
  if (jwk.kty !== "EC") {
    throw new Error(`Tipo de clave no soportado: ${jwk.kty}`);
  }

  if (jwk.crv !== "P-256") {
    throw new Error(`Curva no soportada: ${jwk.crv}`);
  }

  if (!jwk.x || !jwk.y) {
    throw new Error("Clave JWK incompleta: faltan coordenadas x o y");
  }

  // Convertir Base64URL a Base64 estándar
  const base64ToBuffer = (base64url: string): Buffer => {
    let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return Buffer.from(base64, "base64");
  };

  const xBytes = base64ToBuffer(jwk.x);
  const yBytes = base64ToBuffer(jwk.y);

  // Construir el punto de la curva en formato no comprimido (04 + X + Y)
  // Este es el formato estándar para puntos de curvas elípticas
  const uncompressedPoint = Buffer.concat([
    Buffer.from([0x04]), // Prefijo de punto no comprimido
    xBytes,              // Coordenada X (32 bytes para P-256)
    yBytes,              // Coordenada Y (32 bytes para P-256)
  ]);

  // Construir la estructura DER para SubjectPublicKeyInfo
  // OID de ECDSA: 1.2.840.10045.2.1
  // OID de P-256: 1.2.840.10045.3.1.7
  const ecOID = Buffer.from([
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID ecPublicKey
  ]);
  const p256OID = Buffer.from([
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID prime256v1
  ]);

  // AlgorithmIdentifier SEQUENCE
  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, ecOID.length + p256OID.length]),
    ecOID,
    p256OID,
  ]);

  // BIT STRING conteniendo el punto de la curva
  const bitString = Buffer.concat([
    Buffer.from([0x03, uncompressedPoint.length + 1, 0x00]), // BIT STRING con 0 bits sin usar
    uncompressedPoint,
  ]);

  // SubjectPublicKeyInfo SEQUENCE completo
  const subjectPublicKeyInfo = Buffer.concat([
    Buffer.from([0x30, algorithmIdentifier.length + bitString.length]),
    algorithmIdentifier,
    bitString,
  ]);

  // Convertir a Base64 y envolver en formato PEM
  const base64 = subjectPublicKeyInfo.toString("base64");
  const pemLines = base64.match(/.{1,64}/g) || [];
  
  return [
    "-----BEGIN PUBLIC KEY-----",
    ...pemLines,
    "-----END PUBLIC KEY-----",
  ].join("\n");
}

/**
 * Importa la clave pública maestra desde JWK a formato usable por Node.js
 * 
 * @param jwk - Clave pública en formato JWK
 * @returns Objeto KeyObject de Node.js
 */
function importarClavePublica(jwk: JWK): ReturnType<typeof createPublicKey> {
  console.log("🔑 [BACKEND] Importando clave pública maestra desde JWK...");

  const pem = jwkToPEM(jwk);
  const publicKey = createPublicKey(pem);

  console.log("✅ [BACKEND] Clave pública importada exitosamente");
  console.log("   Tipo:", publicKey.asymmetricKeyType);
  console.log("   Formato:", publicKey.asymmetricKeyDetails?.namedCurve);

  return publicKey;
}

/**
 * Reconstruye el payload original en formato JSON canónico
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #6:
 * Para verificar la firma, debemos reconstruir EXACTAMENTE el mismo
 * string JSON que fue firmado. Cualquier diferencia (espacios, orden de campos)
 * invalidaría la verificación.
 * 
 * @param payload - Payload de delegación
 * @returns String JSON canónico
 */
function reconstruirPayload(payload: DelegationPayload): string {
  // Usar JSON.stringify sin espacios (mismo formato que usó el móvil)
  return JSON.stringify(payload);
}

/**
 * Convierte una firma ECDSA del formato raw (r||s) al formato DER (ASN.1)
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #5.5:
 * WebCrypto API genera firmas ECDSA en formato "raw": r concatenado con s
 * (cada uno de 32 bytes para P-256 = 64 bytes total).
 * Node.js crypto.verify() espera formato DER (ASN.1): SEQUENCE { INTEGER r, INTEGER s }
 * Esta función realiza la conversión necesaria.
 * 
 * @param rawSignature - Firma en formato raw (64 bytes para P-256)
 * @returns Firma en formato DER
 */
function rawSignatureToDER(rawSignature: Uint8Array): Buffer {
  const halfLength = rawSignature.length / 2;
  let r = rawSignature.slice(0, halfLength);
  let s = rawSignature.slice(halfLength);

  // Eliminar ceros a la izquierda (leading zeros) pero mantener el signo
  // En ASN.1 DER, los INTEGERs son signed, así que si el byte más significativo
  // tiene el bit 7 en 1, necesitamos agregar un 0x00 al inicio
  const trimLeadingZeros = (buf: Uint8Array): Uint8Array => {
    let i = 0;
    while (i < buf.length - 1 && buf[i] === 0) {
      i++;
    }
    return buf.slice(i);
  };

  r = trimLeadingZeros(r);
  s = trimLeadingZeros(s);

  // Si el byte más significativo tiene el bit 7 en 1, agregar 0x00
  if (r[0] & 0x80) {
    r = Buffer.concat([Buffer.from([0x00]), r]);
  }
  if (s[0] & 0x80) {
    s = Buffer.concat([Buffer.from([0x00]), s]);
  }

  // Construir la estructura DER: SEQUENCE { INTEGER r, INTEGER s }
  const rDER = Buffer.concat([Buffer.from([0x02, r.length]), r]);
  const sDER = Buffer.concat([Buffer.from([0x02, s.length]), s]);
  const sequence = Buffer.concat([rDER, sDER]);

  return Buffer.concat([Buffer.from([0x30, sequence.length]), sequence]);
}

/**
 * Verifica criptográficamente la firma del payload
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #7:
 * - Usa ECDSA con SHA-256 para verificar
 * - La verificación matemática confirma:
 *   ✓ La firma fue creada con la clave privada correspondiente
 *   ✓ El payload no fue modificado después de ser firmado
 *   ✓ El firmante es quien dice ser (posee la clave privada maestra)
 * 
 * @param payload - Payload de delegación original
 * @param firmaHex - Firma en formato hexadecimal
 * @param clavePublicaMaestra - Clave pública del celular (JWK)
 * @returns true si la firma es válida, false si no
 */
function verificarFirma(
  payload: DelegationPayload,
  firmaHex: string,
  clavePublicaMaestra: JWK
): boolean {
  console.log("🔍 [BACKEND] Verificando firma criptográfica...");

  try {
    // PASO 1: Importar la clave pública
    const publicKey = importarClavePublica(clavePublicaMaestra);

    // PASO 2: Reconstruir el payload original
    const payloadJSON = reconstruirPayload(payload);
    const payloadBytes = Buffer.from(payloadJSON, "utf-8");

    console.log("   Payload reconstruido:", payloadBytes.length, "bytes");

    // PASO 3: Convertir la firma de hex a Buffer
    const firmaRaw = hexToBuffer(firmaHex);

    console.log("   Firma raw (WebCrypto):", firmaRaw.length, "bytes");

    // PASO 4: Convertir firma raw (r||s) a formato DER (ASN.1)
    // WebCrypto genera firmas en formato raw, Node.js espera DER
    const firmaDER = rawSignatureToDER(firmaRaw);

    console.log("   Firma DER (Node.js):", firmaDER.length, "bytes");

    // PASO 5: Crear el verificador ECDSA-SHA256
    const verifier = createVerify("SHA256");
    verifier.update(payloadBytes);
    verifier.end();

    // PASO 6: Verificar la firma
    // verify() retorna true solo si la firma es matemáticamente válida
    const esValida = verifier.verify(publicKey, firmaDER);

    if (esValida) {
      console.log("✅ [BACKEND] Firma verificada exitosamente");
      console.log("   La firma es matemáticamente válida");
      console.log("   El payload fue firmado por el dueño de la clave maestra");
    } else {
      console.log("❌ [BACKEND] Firma INVÁLIDA");
      console.log("   La firma no corresponde al payload o a la clave pública");
    }

    return esValida;
  } catch (error) {
    console.error("❌ [BACKEND] Error durante la verificación:", error);
    return false;
  }
}

/**
 * Verifica que la delegación no haya expirado
 * 
 * @param payload - Payload de delegación
 * @returns Objeto con estado de expiración y tiempo restante
 */
function verificarExpiracion(payload: DelegationPayload): {
  expirado: boolean;
  tiempo_restante_ms?: number;
} {
  const ahora = Date.now();
  const expirado = ahora > payload.expiracion;
  const tiempoRestante = payload.expiracion - ahora;

  if (expirado) {
    console.log("⏰ [BACKEND] Delegación EXPIRADA");
    console.log("   Expiró hace:", Math.abs(tiempoRestante) / 1000, "segundos");
  } else {
    console.log("⏰ [BACKEND] Delegación vigente");
    console.log("   Tiempo restante:", tiempoRestante / 1000, "segundos");
    console.log("   Expira:", new Date(payload.expiracion).toISOString());
  }

  return {
    expirado,
    tiempo_restante_ms: expirado ? undefined : tiempoRestante,
  };
}

/**
 * Función principal de verificación
 * Orquesta todo el flujo del backend:
 * 1. Verifica la firma criptográfica
 * 2. Verifica la expiración
 * 3. Retorna el resultado completo
 * 
 * @param delegacion - Paquete completo recibido de la app móvil
 * @returns Resultado de la verificación
 */
export function verificarDelegacion(delegacion: DelegationResult): VerificationResult {
  console.log("\n" + "█".repeat(60));
  console.log("█  VERIFICADOR BACKEND - KeyPass Auth");
  console.log("█  Verificación de Delegación Criptográfica");
  console.log("█".repeat(60) + "\n");

  // PASO 1: Verificar firma criptográfica
  const firmaValida = verificarFirma(
    delegacion.payload,
    delegacion.firma,
    delegacion.clave_publica_maestra
  );

  if (!firmaValida) {
    return {
      valido: false,
      mensaje: "Firma criptográfica inválida",
      payload: delegacion.payload,
    };
  }

  // PASO 2: Verificar expiración
  const expiracion = verificarExpiracion(delegacion.payload);

  if (expiracion.expirado) {
    return {
      valido: false,
      mensaje: "Delegación expirada",
      payload: delegacion.payload,
      detalles: expiracion,
    };
  }

  // PASO 3: Todo válido
  console.log("\n🎉 [BACKEND] DELEGACIÓN AUTORIZADA");
  console.log("   ✓ Firma válida");
  console.log("   ✓ No expirada");
  console.log("   ✓ Listo para crear sesión");

  return {
    valido: true,
    mensaje: "Delegación verificada exitosamente",
    payload: delegacion.payload,
    detalles: expiracion,
  };
}

/**
 * Función principal de demostración
 */
export function main(delegacion: DelegationResult): VerificationResult {
  const resultado = verificarDelegacion(delegacion);

  console.log("\n" + "=".repeat(60));
  console.log("📋 RESULTADO DE VERIFICACIÓN");
  console.log("=".repeat(60));
  console.log(JSON.stringify(resultado, null, 2));
  console.log("=".repeat(60) + "\n");

  return resultado;
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  console.error("❌ Este script debe ejecutarse desde demo.ts");
  console.error("   Ejecutar: npm run demo");
  process.exit(1);
}
