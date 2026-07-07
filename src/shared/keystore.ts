/**
 * INTERFAZ ABSTRACTA - KeyStore para Almacenamiento Seguro de Claves
 * 
 * Define la interfaz para el almacenamiento seguro de claves criptográficas.
 * Permite diferentes implementaciones según la plataforma:
 * - Web: localStorage (solo para demo, NO seguro)
 * - iOS: Secure Enclave (producción)
 * - Android: Keystore (producción)
 * 
 * En producción, las claves privadas NUNCA deben salir del hardware seguro.
 */

import type { JWK } from "../shared/types.js";

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Metadatos de una clave almacenada
 */
export interface KeyMetadata {
  id: string; // Identificador único de la clave
  algoritmo: string; // Ej: "ECDSA"
  curva: string; // Ej: "P-256"
  creado_en: number; // Timestamp Unix
  proposito: string; // Ej: "master-key", "signing-key"
  plataforma: string; // Ej: "web", "ios", "android"
}

/**
 * Resultado de una operación de KeyStore
 */
export interface KeyStoreResult<T> {
  exito: boolean;
  data?: T;
  error?: string;
}

/**
 * Interfaz abstracta para KeyStore
 * Define los métodos que deben implementar todas las plataformas
 */
export interface IKeyStore {
  /**
   * Genera un nuevo par de claves y lo almacena de forma segura
   * 
   * @param id - Identificador único para la clave
   * @param algoritmo - Algoritmo criptográfico (ej: "ECDSA")
   * @param curva - Curva elíptica (ej: "P-256")
   * @param proposito - Propósito de la clave (ej: "master-key")
   * @returns Resultado con los metadatos de la clave generada
   */
  generarClave(
    id: string,
    algoritmo: string,
    curva: string,
    proposito: string
  ): Promise<KeyStoreResult<KeyMetadata>>;

  /**
   * Obtiene la clave pública de una clave almacenada
   * La clave privada NUNCA se exporta
   * 
   * @param id - Identificador de la clave
   * @returns Resultado con la clave pública en formato JWK
   */
  obtenerClavePublica(id: string): Promise<KeyStoreResult<JWK>>;

  /**
   * Firma datos usando la clave privada almacenada
   * La clave privada NUNCA sale del hardware seguro
   * 
   * @param id - Identificador de la clave
   * @param datos - Datos a firmar (ArrayBuffer)
   * @param algoritmo - Algoritmo de firma (ej: { name: "ECDSA", hash: "SHA-256" })
   * @returns Resultado con la firma en formato ArrayBuffer
   */
  firmar(
    id: string,
    datos: ArrayBuffer,
    algoritmo: AlgorithmIdentifier
  ): Promise<KeyStoreResult<ArrayBuffer>>;

  /**
   * Verifica si una clave existe en el KeyStore
   * 
   * @param id - Identificador de la clave
   * @returns true si la clave existe, false si no
   */
  existeClave(id: string): Promise<boolean>;

  /**
   * Elimina una clave del KeyStore
   * 
   * @param id - Identificador de la clave
   * @returns Resultado de la operación
   */
  eliminarClave(id: string): Promise<KeyStoreResult<void>>;

  /**
   * Lista todas las claves almacenadas
   * 
   * @returns Resultado con la lista de metadatos de claves
   */
  listarClaves(): Promise<KeyStoreResult<KeyMetadata[]>>;

  /**
   * Obtiene información sobre la plataforma de almacenamiento
   * 
   * @returns Nombre de la plataforma (ej: "web-localstorage", "ios-secure-enclave")
   */
  getPlataforma(): string;

  /**
   * Verifica si el KeyStore es seguro para producción
   * 
   * @returns true si es seguro, false si es solo para demo
   */
  esSeguro(): boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// IMPLEMENTACIÓN WEB (localStorage - SOLO PARA DEMO)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Implementación de KeyStore para Web usando localStorage
 * 
 * ⚠️ ADVERTENCIA: Esta implementación NO es segura para producción.
 * Las claves se almacenan en localStorage, que puede ser accedido por JavaScript.
 * En producción, usar Secure Enclave (iOS) o Keystore (Android).
 * 
 * Esta implementación es solo para demostración y testing.
 */
export class WebKeyStore implements IKeyStore {
  private readonly STORAGE_PREFIX = "keypass_keystore_";

  /**
   * Genera un par de claves y lo almacena en localStorage
   */
  async generarClave(
    id: string,
    algoritmo: string,
    curva: string,
    proposito: string
  ): Promise<KeyStoreResult<KeyMetadata>> {
    try {
      console.log(`🔑 [WebKeyStore] Generando clave: ${id}`);

      // Generar par de claves
      const keyPair = await crypto.subtle.generateKey(
        { name: algoritmo, namedCurve: curva },
        true, // extractable: true (necesario para exportar)
        ["sign", "verify"]
      );

      // Exportar clave privada como JWK
      const privateJWK = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

      // Almacenar en localStorage
      const storageKey = this.STORAGE_PREFIX + id;
      localStorage.setItem(storageKey, JSON.stringify(privateJWK));

      // Crear metadatos
      const metadata: KeyMetadata = {
        id,
        algoritmo,
        curva,
        creado_en: Date.now(),
        proposito,
        plataforma: this.getPlataforma(),
      };

      // Almacenar metadatos
      localStorage.setItem(
        `${storageKey}_metadata`,
        JSON.stringify(metadata)
      );

      console.log(`✅ [WebKeyStore] Clave generada y almacenada: ${id}`);

      return { exito: true, data: metadata };
    } catch (error) {
      console.error(`❌ [WebKeyStore] Error generando clave:`, error);
      return {
        exito: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    }
  }

  /**
   * Obtiene la clave pública de una clave almacenada
   */
  async obtenerClavePublica(id: string): Promise<KeyStoreResult<JWK>> {
    try {
      const storageKey = this.STORAGE_PREFIX + id;
      const privateJWKStr = localStorage.getItem(storageKey);

      if (!privateJWKStr) {
        return { exito: false, error: `Clave no encontrada: ${id}` };
      }

      const privateJWK = JSON.parse(privateJWKStr);

      // Importar clave privada
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        privateJWK,
        { name: privateJWK.alg?.includes("ES256") ? "ECDSA" : "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"]
      );

      // Exportar solo la clave pública
      // Nota: WebCrypto no permite extraer solo la pública de una privada importada
      // Por lo tanto, construimos la pública manualmente desde las coordenadas
      const publicJWK: JWK = {
        kty: privateJWK.kty,
        crv: privateJWK.crv,
        x: privateJWK.x,
        y: privateJWK.y,
      };

      return { exito: true, data: publicJWK };
    } catch (error) {
      console.error(`❌ [WebKeyStore] Error obteniendo clave pública:`, error);
      return {
        exito: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    }
  }

  /**
   * Firma datos usando la clave privada almacenada
   */
  async firmar(
    id: string,
    datos: ArrayBuffer,
    algoritmo: AlgorithmIdentifier
  ): Promise<KeyStoreResult<ArrayBuffer>> {
    try {
      const storageKey = this.STORAGE_PREFIX + id;
      const privateJWKStr = localStorage.getItem(storageKey);

      if (!privateJWKStr) {
        return { exito: false, error: `Clave no encontrada: ${id}` };
      }

      const privateJWK = JSON.parse(privateJWKStr);

      // Importar clave privada
      const privateKey = await crypto.subtle.importKey(
        "jwk",
        privateJWK,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["sign"]
      );

      // Firmar datos
      const firma = await crypto.subtle.sign(algoritmo, privateKey, datos);

      return { exito: true, data: firma };
    } catch (error) {
      console.error(`❌ [WebKeyStore] Error firmando:`, error);
      return {
        exito: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    }
  }

  /**
   * Verifica si una clave existe
   */
  async existeClave(id: string): Promise<boolean> {
    const storageKey = this.STORAGE_PREFIX + id;
    return localStorage.getItem(storageKey) !== null;
  }

  /**
   * Elimina una clave del KeyStore
   */
  async eliminarClave(id: string): Promise<KeyStoreResult<void>> {
    try {
      const storageKey = this.STORAGE_PREFIX + id;
      localStorage.removeItem(storageKey);
      localStorage.removeItem(`${storageKey}_metadata`);

      console.log(`✅ [WebKeyStore] Clave eliminada: ${id}`);
      return { exito: true };
    } catch (error) {
      console.error(`❌ [WebKeyStore] Error eliminando clave:`, error);
      return {
        exito: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    }
  }

  /**
   * Lista todas las claves almacenadas
   */
  async listarClaves(): Promise<KeyStoreResult<KeyMetadata[]>> {
    try {
      const claves: KeyMetadata[] = [];

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(this.STORAGE_PREFIX) && key.endsWith("_metadata")) {
          const metadataStr = localStorage.getItem(key);
          if (metadataStr) {
            claves.push(JSON.parse(metadataStr));
          }
        }
      }

      return { exito: true, data: claves };
    } catch (error) {
      console.error(`❌ [WebKeyStore] Error listando claves:`, error);
      return {
        exito: false,
        error: error instanceof Error ? error.message : "Error desconocido",
      };
    }
  }

  /**
   * Obtiene la plataforma de almacenamiento
   */
  getPlataforma(): string {
    return "web-localstorage";
  }

  /**
   * Verifica si el KeyStore es seguro
   */
  esSeguro(): boolean {
    return false; // localStorage NO es seguro para producción
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STUBS PARA iOS Y ANDROID (Solo interfaces, requieren implementación nativa)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Stub para iOS Secure Enclave
 * Requiere implementación nativa en Swift/Objective-C
 */
export class IOSSecureEnclaveKeyStore implements IKeyStore {
  async generarClave(): Promise<KeyStoreResult<KeyMetadata>> {
    throw new Error("No implementado: requiere bridge nativo a Secure Enclave");
  }

  async obtenerClavePublica(): Promise<KeyStoreResult<JWK>> {
    throw new Error("No implementado: requiere bridge nativo a Secure Enclave");
  }

  async firmar(): Promise<KeyStoreResult<ArrayBuffer>> {
    throw new Error("No implementado: requiere bridge nativo a Secure Enclave");
  }

  async existeClave(): Promise<boolean> {
    throw new Error("No implementado: requiere bridge nativo a Secure Enclave");
  }

  async eliminarClave(): Promise<KeyStoreResult<void>> {
    throw new Error("No implementado: requiere bridge nativo a Secure Enclave");
  }

  async listarClaves(): Promise<KeyStoreResult<KeyMetadata[]>> {
    throw new Error("No implementado: requiere bridge nativo a Secure Enclave");
  }

  getPlataforma(): string {
    return "ios-secure-enclave";
  }

  esSeguro(): boolean {
    return true; // Secure Enclave es seguro
  }
}

/**
 * Stub para Android Keystore
 * Requiere implementación nativa en Kotlin/Java
 */
export class AndroidKeystoreKeyStore implements IKeyStore {
  async generarClave(): Promise<KeyStoreResult<KeyMetadata>> {
    throw new Error("No implementado: requiere bridge nativo a Android Keystore");
  }

  async obtenerClavePublica(): Promise<KeyStoreResult<JWK>> {
    throw new Error("No implementado: requiere bridge nativo a Android Keystore");
  }

  async firmar(): Promise<KeyStoreResult<ArrayBuffer>> {
    throw new Error("No implementado: requiere bridge nativo a Android Keystore");
  }

  async existeClave(): Promise<boolean> {
    throw new Error("No implementado: requiere bridge nativo a Android Keystore");
  }

  async eliminarClave(): Promise<KeyStoreResult<void>> {
    throw new Error("No implementado: requiere bridge nativo a Android Keystore");
  }

  async listarClaves(): Promise<KeyStoreResult<KeyMetadata[]>> {
    throw new Error("No implementado: requiere bridge nativo a Android Keystore");
  }

  getPlataforma(): string {
    return "android-keystore";
  }

  esSeguro(): boolean {
    return true; // Android Keystore es seguro
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Factory para crear la instancia apropiada de KeyStore según la plataforma
 */
export function createKeyStore(): IKeyStore {
  // Detectar plataforma
  const isBrowser = typeof window !== "undefined";
  const isNode = typeof process !== "undefined" && process.versions?.node;

  if (isBrowser) {
    console.log("🔑 [KeyStore] Usando WebKeyStore (localStorage)");
    console.log("⚠️  [KeyStore] Esta implementación NO es segura para producción");
    return new WebKeyStore();
  }

  // En producción, detectar iOS/Android y usar implementaciones nativas
  // Por ahora, solo soportamos Web
  throw new Error("Plataforma no soportada. Solo Web está implementado.");
}
