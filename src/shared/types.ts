/**
 * Tipos compartidos para KeyPass Auth
 * Define las estructuras de datos que fluyen entre los 3 componentes
 */

/**
 * JSON Web Key (JWK) - Formato estándar para representar claves criptográficas
 * Usado para exportar/importar claves públicas entre componentes
 */
export interface JWK {
  kty: string;      // Key Type (ej: "EC" para Elliptic Curve)
  crv: string;      // Curve (ej: "P-256")
  x: string;        // Coordenada X de la clave pública (Base64URL)
  y: string;        // Coordenada Y de la clave pública (Base64URL)
  d?: string;       // Coordenada privada (solo para claves privadas, Base64URL)
  key_ops?: string[]; // Operaciones permitidas (ej: ["sign", "verify"])
  ext?: boolean;    // Extractable (si la clave puede ser exportada)
}

/**
 * Payload de delegación criptográfica
 * Contiene la autorización de la app móvil hacia la notebook
 */
export interface DelegationPayload {
  autorizado: JWK;        // Clave pública efímera de la notebook
  expiracion: number;     // Timestamp Unix (ms) cuando expira la delegación
  emitido_en: number;     // Timestamp Unix (ms) cuando se emitió
  dispositivo_id?: string; // Identificador único del dispositivo (opcional)
}

/**
 * Resultado completo del proceso de delegación
 * Incluye el payload, la firma y metadatos adicionales
 */
export interface DelegationResult {
  payload: DelegationPayload;
  firma: string;          // Firma en formato hexadecimal
  clave_publica_maestra: JWK; // Clave pública maestra del celular (para verificación)
  algoritmo: string;      // Algoritmo usado (ej: "ECDSA")
  curva: string;          // Curva elíptica usada (ej: "P-256")
}

/**
 * Respuesta del verificador backend
 */
export interface VerificationResult {
  valido: boolean;
  mensaje: string;
  payload?: DelegationPayload;
  detalles?: {
    expirado: boolean;
    tiempo_restante_ms?: number;
  };
}
