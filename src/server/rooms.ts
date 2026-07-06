/**
 * GESTIÓN DE SALAS WEBSOCKET
 * 
 * Maneja las salas de comunicación entre Notebook y Celular.
 * Cada sala tiene un ID único (UUID) y conecta exactamente:
 * - 1 Notebook (que espera la delegación)
 * - 1+ Celulares (que envían la delegación)
 * 
 * Flujo:
 * 1. Notebook se conecta → se crea sala → se asigna salaId
 * 2. Celular escanea QR (que contiene salaId) → se conecta a esa sala
 * 3. Celular envía paquete de delegación → servidor retransmite a Notebook
 */

import type { WebSocket } from "ws";
import type {
  DelegationResult,
  WSRoomAssigned,
  WSDelegationReceived,
  WSDelegationAck,
  WSError,
} from "../shared/types.js";

/**
 * Estado de una sala WebSocket
 */
export interface Room {
  salaId: string;
  notebook: WebSocket | null;     // Socket de la notebook
  celulares: Set<WebSocket>;      // Sockets de los celulares conectados
  createdAt: number;              // Timestamp de creación
  lastActivity: number;           // Timestamp de última actividad
}

/**
 * Mapa global de salas activas
 * Key: salaId (UUID)
 * Value: estado de la sala
 */
const rooms = new Map<string, Room>();

/**
 * Crea una nueva sala y registra la notebook
 * 
 * @param notebookSocket - WebSocket de la notebook conectada
 * @returns salaId único de la sala creada
 */
export function crearSala(notebookSocket: WebSocket): string {
  const salaId = crypto.randomUUID();
  
  const room: Room = {
    salaId,
    notebook: notebookSocket,
    celulares: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };

  rooms.set(salaId, room);
  console.log(`🏠 [ROOMS] Sala creada: ${salaId}`);
  console.log(`   Salas activas: ${rooms.size}`);

  return salaId;
}

/**
 * Obtiene una sala por su ID
 * 
 * @param salaId - ID de la sala
 * @returns Estado de la sala o undefined si no existe
 */
export function obtenerSala(salaId: string): Room | undefined {
  return rooms.get(salaId);
}

/**
 * Registra un celular en una sala existente
 * 
 * @param salaId - ID de la sala
 * @param celularSocket - WebSocket del celular
 * @returns true si se registró exitosamente, false si la sala no existe
 */
export function registrarCelularEnSala(
  salaId: string,
  celularSocket: WebSocket
): boolean {
  const room = rooms.get(salaId);
  if (!room) {
    console.log(`❌ [ROOMS] Sala no encontrada: ${salaId}`);
    return false;
  }

  room.celulares.add(celularSocket);
  room.lastActivity = Date.now();
  console.log(`📱 [ROOMS] Celular registrado en sala ${salaId}`);
  console.log(`   Celulares en sala: ${room.celulares.size}`);

  return true;
}

/**
 * Retransmite un paquete de delegación del celular a la notebook
 * 
 * @param salaId - ID de la sala
 * @param paquete - Paquete de delegación a retransmitir
 * @returns true si se retransmitió exitosamente
 */
export function retransmitirANotebook(
  salaId: string,
  paquete: DelegationResult
): boolean {
  const room = rooms.get(salaId);
  if (!room || !room.notebook) {
    console.log(`❌ [ROOMS] No se puede retransmitir: sala ${salaId} sin notebook`);
    return false;
  }

  // Verificar que la notebook esté conectada
  if (room.notebook.readyState !== 1) { // 1 = OPEN
    console.log(`❌ [ROOMS] Notebook no conectada en sala ${salaId}`);
    return false;
  }

  // Construir mensaje para la notebook
  const mensaje: WSDelegationReceived = {
    tipo: "delegacion_recibida",
    paquete,
  };

  try {
    room.notebook.send(JSON.stringify(mensaje));
    room.lastActivity = Date.now();
    console.log(`✅ [ROOMS] Paquete retransmitido a notebook en sala ${salaId}`);
    return true;
  } catch (error) {
    console.error(`❌ [ROOMS] Error al retransmitir:`, error);
    return false;
  }
}

/**
 * Envía confirmación al celular después de retransmitir
 * 
 * @param celularSocket - WebSocket del celular
 * @param salaId - ID de la sala
 * @param exito - Si la retransmisión fue exitosa
 */
export function enviarAckACelular(
  celularSocket: WebSocket,
  salaId: string,
  exito: boolean
): void {
  const mensaje: WSDelegationAck = {
    tipo: "delegacion_ack",
    salaId,
    exito,
    mensaje: exito
      ? "Delegación retransmitida a la notebook exitosamente"
      : "Error al retransmitir la delegación",
  };

  try {
    celularSocket.send(JSON.stringify(mensaje));
    console.log(`✅ [ROOMS] ACK enviado al celular en sala ${salaId}`);
  } catch (error) {
    console.error(`❌ [ROOMS] Error al enviar ACK:`, error);
  }
}

/**
 * Envía el salaId a la notebook al conectarse
 * 
 * @param notebookSocket - WebSocket de la notebook
 * @param salaId - ID de la sala asignada
 */
export function enviarSalaIdANotebook(
  notebookSocket: WebSocket,
  salaId: string
): void {
  const mensaje: WSRoomAssigned = {
    tipo: "sala_asignada",
    salaId,
  };

  try {
    notebookSocket.send(JSON.stringify(mensaje));
    console.log(`✅ [ROOMS] salaId enviado a notebook: ${salaId}`);
  } catch (error) {
    console.error(`❌ [ROOMS] Error al enviar salaId:`, error);
  }
}

/**
 * Envía un mensaje de error a un cliente
 * 
 * @param socket - WebSocket del cliente
 * @param mensaje - Mensaje de error
 */
export function enviarError(socket: WebSocket, mensaje: string): void {
  const error: WSError = {
    tipo: "error",
    mensaje,
  };

  try {
    socket.send(JSON.stringify(error));
  } catch (err) {
    console.error(`❌ [ROOMS] Error al enviar mensaje de error:`, err);
  }
}

/**
 * Limpia una notebook desconectada de su sala
 * 
 * @param socket - WebSocket de la notebook desconectada
 */
export function limpiarNotebook(socket: WebSocket): void {
  for (const [salaId, room] of rooms.entries()) {
    if (room.notebook === socket) {
      room.notebook = null;
      console.log(`🧹 [ROOMS] Notebook desconectada de sala ${salaId}`);
      
      // Si no hay notebook ni celulares, eliminar la sala
      if (room.celulares.size === 0) {
        rooms.delete(salaId);
        console.log(`🗑️  [ROOMS] Sala eliminada (vacía): ${salaId}`);
      }
      break;
    }
  }
}

/**
 * Limpia un celular desconectado de su sala
 * 
 * @param socket - WebSocket del celular desconectado
 */
export function limpiarCelular(socket: WebSocket): void {
  for (const [salaId, room] of rooms.entries()) {
    if (room.celulares.has(socket)) {
      room.celulares.delete(socket);
      console.log(`🧹 [ROOMS] Celular desconectado de sala ${salaId}`);
      
      // Si no hay notebook ni celulares, eliminar la sala
      if (!room.notebook && room.celulares.size === 0) {
        rooms.delete(salaId);
        console.log(`🗑️  [ROOMS] Sala eliminada (vacía): ${salaId}`);
      }
      break;
    }
  }
}

/**
 * Obtiene estadísticas de las salas activas
 */
export function obtenerEstadisticas(): {
  totalSalas: number;
  totalNotebooks: number;
  totalCelulares: number;
} {
  let totalNotebooks = 0;
  let totalCelulares = 0;

  for (const room of rooms.values()) {
    if (room.notebook) totalNotebooks++;
    totalCelulares += room.celulares.size;
  }

  return {
    totalSalas: rooms.size,
    totalNotebooks,
    totalCelulares,
  };
}

/**
 * Limpia salas inactivas (más de 1 hora sin actividad)
 * Debería llamarse periódicamente con un setInterval
 */
export function limpiarSalasInactivas(): void {
  const ahora = Date.now();
  const TIEMPO_MAX_INACTIVIDAD = 60 * 60 * 1000; // 1 hora

  for (const [salaId, room] of rooms.entries()) {
    if (ahora - room.lastActivity > TIEMPO_MAX_INACTIVIDAD) {
      rooms.delete(salaId);
      console.log(`🧹 [ROOMS] Sala inactiva eliminada: ${salaId}`);
    }
  }
}
