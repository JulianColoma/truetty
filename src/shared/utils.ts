/**
 * Utilidades criptográficas compartidas
 * Funciones de conversión y helpers usados por los 3 componentes
 */

/**
 * Convierte un ArrayBuffer a string hexadecimal
 * @param buffer - ArrayBuffer a convertir
 * @returns String hexadecimal en minúsculas
 */
export function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convierte un string hexadecimal a Uint8Array
 * @param hex - String hexadecimal a convertir
 * @returns Uint8Array con los bytes
 */
export function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Convierte un ArrayBuffer a Base64URL (sin padding)
 * Usado para la exportación de claves JWK
 * @param buffer - ArrayBuffer a convertir
 * @returns String Base64URL
 */
export function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Convierte un string Base64URL a ArrayBuffer
 * @param base64url - String Base64URL a convertir
 * @returns ArrayBuffer
 */
export function base64UrlToBuffer(base64url: string): ArrayBuffer {
  // Restaurar padding y caracteres estándar de Base64
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Convierte un string UTF-8 a ArrayBuffer
 * @param str - String a convertir
 * @returns ArrayBuffer con la codificación UTF-8
 */
export function stringToBuffer(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer;
}

/**
 * Convierte un ArrayBuffer a string UTF-8
 * @param buffer - ArrayBuffer a convertir
 * @returns String UTF-8
 */
export function bufferToString(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

/**
 * Genera un identificador único para dispositivos
 * Usa crypto.randomUUID() si está disponible, sino genera uno manual
 * @returns String UUID v4
 */
export function generateDeviceId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback manual
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
