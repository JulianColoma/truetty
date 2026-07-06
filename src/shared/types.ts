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

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS PARA WEBSOCKET (v2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mensaje que envía el servidor a la Notebook al conectarse
 * Contiene el salaId único para esta sesión
 */
export interface WSRoomAssigned {
  tipo: "sala_asignada";
  salaId: string;
}

/**
 * Mensaje que envía el Celular al servidor para unirse a una sala
 * y enviar el paquete de delegación
 */
export interface WSDelegationSend {
  tipo: "delegacion_enviar";
  salaId: string;
  paquete: DelegationResult;
}

/**
 * Mensaje que retransmite el servidor a la Notebook
 * Contiene el paquete de delegación del celular
 */
export interface WSDelegationReceived {
  tipo: "delegacion_recibida";
  paquete: DelegationResult;
}

/**
 * Mensaje de confirmación que envía el servidor al Celular
 * después de retransmitir la delegación
 */
export interface WSDelegationAck {
  tipo: "delegacion_ack";
  salaId: string;
  exito: boolean;
  mensaje: string;
}

/**
 * Mensaje de error genérico del WebSocket
 */
export interface WSError {
  tipo: "error";
  mensaje: string;
}

/**
 * Unión de todos los mensajes posibles del servidor al cliente
 */
export type WSServerMessage =
  | WSRoomAssigned
  | WSDelegationReceived
  | WSDelegationAck
  | WSError;

/**
 * Unión de todos los mensajes posibles del cliente al servidor
 */
export type WSClientMessage = WSDelegationSend;

/**
 * QR Payload que se codifica en el código QR
 * Incluye la clave pública efímera y el salaId
 */
export interface QRPayload {
  version: string;
  tipo: "keypass-auth-qr";
  salaId: string;
  clave_publica: JWK;
  timestamp: number;
  metadata: {
    algoritmo: string;
    curva: string;
    proposito: string;
    servidor_ws: string; // URL del servidor WebSocket
  };
}

/**
 * Respuesta del endpoint /api/verify
 */
export interface VerifyResponse {
  valido: boolean;
  mensaje: string;
  sessionToken?: string;
  expira_en?: number;
}
