/**
 * CLIENTE WEB ESCLAVO (Notebook del Usuario)
 * 
 * Este componente simula el navegador de la notebook que necesita ser autorizado.
 * Genera un par de claves efímeras ECDSA P-256 y exporta la clave pública en JWK
 * para ser incluida en un código QR ficticio.
 * 
 * Flujo:
 * 1. Genera par de claves efímeras (solo para esta sesión)
 * 2. Exporta la clave pública en formato JWK
 * 3. La clave pública se codificaría en un QR para que el celular la escanee
 */

import type { JWK } from "../shared/types.js";
import { bufferToBase64Url, generateDeviceId } from "../shared/utils.js";

/**
 * Resultado de la generación de claves efímeras
 */
export interface EphemeralKeyPair {
  clavePrivada: CryptoKey;      // Clave privada efímera (no se exporta)
  clavePublica: CryptoKey;      // Clave pública efímera
  clavePublicaJWK: JWK;         // Clave pública en formato JWK (para el QR)
  qrPayload: string;            // String JSON que simula el contenido del QR
  dispositivoId: string;        // ID único del dispositivo
}

/**
 * Genera un par de claves efímeras ECDSA usando la curva P-256
 * 
 * PASO CRIPTOGRÁFICO CRÍTICO #1:
 * - Algoritmo: ECDSA (Elliptic Curve Digital Signature Algorithm)
 * - Curva: P-256 (también conocida como secp256r1 o prime256v1)
 * - Usos: sign (firmar) y verify (verificar)
 * - Extractable: true (necesaria para exportar la pública)
 * 
 * @returns Objeto con las claves generadas y el payload del QR
 */
export async function generarClavesEfimeras(): Promise<EphemeralKeyPair> {
  console.log("🔐 [CLIENTE WEB] Generando par de claves efímeras ECDSA P-256...");

  // PASO 1: Generar el par de claves usando WebCrypto API
  // La clave privada NUNCA sale del navegador
  // La clave pública SÍ se exporta para ser verificada por el backend
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256", // Curva elíptica de 256 bits (seguridad equivalente a RSA-3072)
    },
    true, // extractable: true permite exportar las claves
    ["sign", "verify"] // La privada puede firmar, la pública puede verificar
  );

  console.log("✅ [CLIENTE WEB] Par de claves generado exitosamente");

  // PASO 2: Exportar la clave pública en formato JWK
  // JWK es el estándar RFC 7517 para representar claves criptográficas en JSON
  const publicKeyJWK = await crypto.subtle.exportKey("jwk", keyPair.publicKey);

  console.log("📤 [CLIENTE WEB] Clave pública exportada en formato JWK");
  console.log("   Coordenada X:", publicKeyJWK.x?.substring(0, 20) + "...");
  console.log("   Coordenada Y:", publicKeyJWK.y?.substring(0, 20) + "...");

  // PASO 3: Generar ID único del dispositivo
  const deviceId = generateDeviceId();
  console.log("📱 [CLIENTE WEB] ID del dispositivo:", deviceId);

  // PASO 4: Crear el payload del QR ficticio
  // En producción, esto se renderizaría como un código QR real
  // El celular lo escanearía y extraería la clave pública
  const qrData = {
    version: "1.0",
    tipo: "keypass-auth-ephemeral",
    dispositivo_id: deviceId,
    clave_publica: publicKeyJWK,
    timestamp: Date.now(),
    metadata: {
      algoritmo: "ECDSA",
      curva: "P-256",
      proposito: "autenticacion-delegada",
    },
  };

  const qrPayload = JSON.stringify(qrData, null, 2);

  console.log("📱 [CLIENTE WEB] Payload del QR generado (simulado como JSON string)");
  console.log("   Tamaño:", qrPayload.length, "caracteres");

  return {
    clavePrivada: keyPair.privateKey,
    clavePublica: keyPair.publicKey,
    clavePublicaJWK: publicKeyJWK as JWK,
    qrPayload,
    dispositivoId: deviceId,
  };
}

/**
 * Simula la generación y visualización del código QR
 * En producción, esto usaría una librería como qrcode.js para renderizar
 * 
 * @param qrPayload - String JSON que contiene la clave pública
 */
export function mostrarQRSimulado(qrPayload: string): void {
  console.log("\n" + "=".repeat(60));
  console.log("📱 CÓDIGO QR SIMULADO (Notebook → Celular)");
  console.log("=".repeat(60));
  console.log(qrPayload);
  console.log("=".repeat(60));
  console.log("↑ Este JSON se renderizaría como código QR en la pantalla");
  console.log("↑ El celular lo escanearía para obtener la clave pública\n");
}

/**
 * Función principal de demostración del cliente web
 */
export async function main(): Promise<EphemeralKeyPair> {
  console.log("\n" + "█".repeat(60));
  console.log("█  CLIENTE WEB ESCLAVO - KeyPass Auth");
  console.log("█  Generación de Claves Efímeras ECDSA P-256");
  console.log("█".repeat(60) + "\n");

  const resultado = await generarClavesEfimeras();
  mostrarQRSimulado(resultado.qrPayload);

  console.log("✅ [CLIENTE WEB] Proceso completado");
  console.log("   La clave pública está lista para ser escaneada por el celular\n");

  return resultado;
}

// Ejecutar si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
