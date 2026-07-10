/**
 * KeyPass Auth SDK - Widget de Autenticación Descentralizada
 * 
 * SDK autocontenido para integrar autenticación KeyPass en cualquier sitio web
 * usando un simple script y un contenedor <div>.
 * 
 * @example
 * ```html
 * <div id="keypass-widget"></div>
 * <script src="keypass-sdk.js"></script>
 * <script>
 *   KeyPassSDK.init({
 *     elementId: 'keypass-widget',
 *     serverUrl: 'https://localhost:3443',
 *     onSuccess: (token) => console.log('Token:', token),
 *     onError: (error) => console.error('Error:', error)
 *   });
 * </script>
 * ```
 */

import QRCode from 'qrcode';

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS E INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuración del SDK
 */
export interface SDKConfig {
  /** ID del elemento DOM donde se renderizará el widget */
  elementId: string;
  /** URL del servidor backend (ej: https://localhost:3443) */
  serverUrl: string;
  /** Callback ejecutado cuando la autenticación es exitosa */
  onSuccess: (sessionToken: string) => void;
  /** Callback ejecutado cuando ocurre un error */
  onError?: (error: Error) => void;
}

/**
 * JSON Web Key (JWK) - Formato estándar para claves criptográficas
 */
interface JWK {
  kty: string;
  crv: string;
  x: string;
  y: string;
  key_ops?: string[];
  ext?: boolean;
}

/**
 * Payload de delegación criptográfica
 */
interface DelegationPayload {
  autorizado: JWK;
  expiracion: number;
  emitido_en: number;
}

/**
 * Paquete completo de delegación
 */
interface DelegationResult {
  payload: DelegationPayload;
  firma: string;
  clave_publica_maestra: JWK;
  algoritmo: string;
  curva: string;
}

/**
 * Respuesta del endpoint /api/verify
 */
interface VerifyResponse {
  valido: boolean;
  mensaje: string;
  sessionToken?: string;
  expira_en?: number;
}

/**
 * Mensajes del servidor WebSocket
 */
type WSServerMessage = 
  | { tipo: 'sala_asignada'; salaId: string }
  | { tipo: 'delegacion_recibida'; paquete: DelegationResult }
  | { tipo: 'error'; mensaje: string };

/**
 * Estado interno del SDK
 */
interface SDKState {
  ws: WebSocket | null;
  salaId: string | null;
  clavePrivada: CryptoKey | null;
  clavePublicaJWK: JWK | null;
  initialized: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASE PRINCIPAL DEL SDK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * KeyPassSDK - Clase principal del SDK
 * 
 * Gestiona todo el flujo de autenticación descentralizada:
 * 1. Renderiza el widget con QR
 * 2. Conecta al servidor WebSocket
 * 3. Genera claves efímeras ECDSA P-256
 * 4. Escucha delegación del celular
 * 5. Verifica con el backend
 * 6. Ejecuta callback onSuccess
 */
export class KeyPassSDK {
  private config: SDKConfig;
  private state: SDKState;
  private container: HTMLElement | null;

  constructor(config: SDKConfig) {
    this.config = config;
    this.state = {
      ws: null,
      salaId: null,
      clavePrivada: null,
      clavePublicaJWK: null,
      initialized: false,
    };
    this.container = null;
  }

  /**
   * Inicializa el SDK y comienza el flujo de autenticación
   */
  public async init(): Promise<void> {
    try {
      console.log('🔐 [KeyPassSDK] Inicializando...');

      // 1. Obtener contenedor DOM
      this.container = document.getElementById(this.config.elementId);
      if (!this.container) {
        throw new Error(`Elemento con ID '${this.config.elementId}' no encontrado`);
      }

      // 2. Renderizar estado inicial
      this.renderInitialState();

      // 3. Conectar al servidor WebSocket
      await this.connectWebSocket();

      this.state.initialized = true;
      console.log('✅ [KeyPassSDK] Inicializado correctamente');
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Renderiza el estado inicial del widget
   */
  private renderInitialState(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="keypass-widget">
        <div class="keypass-header">
          <h3>🔐 KeyPass Auth</h3>
          <p>Escanea el código QR con tu celular</p>
        </div>
        <div class="keypass-content">
          <div class="keypass-loading">
            <div class="keypass-spinner"></div>
            <p>Conectando al servidor...</p>
          </div>
          <div class="keypass-qr" style="display: none;"></div>
          <div class="keypass-status">
            <span class="keypass-status-text">Esperando escaneo...</span>
          </div>
        </div>
      </div>
    `;

    // Inyectar estilos CSS
    this.injectStyles();
  }

  /**
   * Inyecta los estilos CSS del widget
   */
  private injectStyles(): void {
    const styleId = 'keypass-sdk-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .keypass-widget {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        max-width: 400px;
        margin: 0 auto;
        padding: 24px;
        border: 2px solid #e0e0e0;
        border-radius: 12px;
        background: #ffffff;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .keypass-header {
        text-align: center;
        margin-bottom: 20px;
      }

      .keypass-header h3 {
        margin: 0 0 8px 0;
        font-size: 20px;
        color: #1a1a1a;
      }

      .keypass-header p {
        margin: 0;
        font-size: 14px;
        color: #666;
      }

      .keypass-content {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
      }

      .keypass-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
      }

      .keypass-spinner {
        width: 40px;
        height: 40px;
        border: 4px solid #f3f3f3;
        border-top: 4px solid #6366f1;
        border-radius: 50%;
        animation: keypass-spin 1s linear infinite;
      }

      @keyframes keypass-spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      .keypass-qr {
        padding: 16px;
        background: white;
        border-radius: 8px;
      }

      .keypass-qr canvas {
        display: block;
      }

      .keypass-status {
        text-align: center;
      }

      .keypass-status-text {
        font-size: 14px;
        color: #666;
      }

      .keypass-success {
        text-align: center;
        padding: 20px;
      }

      .keypass-success-icon {
        font-size: 48px;
        margin-bottom: 12px;
      }

      .keypass-success h4 {
        margin: 0 0 8px 0;
        color: #10b981;
        font-size: 18px;
      }

      .keypass-success p {
        margin: 0;
        color: #666;
        font-size: 14px;
      }

      .keypass-error {
        text-align: center;
        padding: 20px;
        color: #ef4444;
      }

      .keypass-error-icon {
        font-size: 48px;
        margin-bottom: 12px;
      }
    `;

    document.head.appendChild(style);
  }

  /**
   * Conecta al servidor WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.serverUrl}/ws`;
      console.log('🔌 [KeyPassSDK] Conectando a WebSocket:', wsUrl);

      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('✅ [KeyPassSDK] WebSocket conectado');
        this.state.ws = ws;
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const message: WSServerMessage = JSON.parse(event.data);
          this.handleWSMessage(message);
        } catch (error) {
          console.error('❌ [KeyPassSDK] Error procesando mensaje:', error);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ [KeyPassSDK] Error en WebSocket:', error);
        this.handleError(new Error('Error de conexión WebSocket'));
        reject(error);
      };

      ws.onclose = () => {
        console.log('👋 [KeyPassSDK] WebSocket cerrado');
        this.state.ws = null;
      };
    });
  }

  /**
   * Maneja los mensajes del servidor WebSocket
   */
  private async handleWSMessage(message: WSServerMessage): Promise<void> {
    console.log('📨 [KeyPassSDK] Mensaje recibido:', message.tipo);

    switch (message.tipo) {
      case 'sala_asignada':
        await this.handleSalaAsignada(message.salaId);
        break;

      case 'delegacion_recibida':
        await this.handleDelegacionRecibida(message.paquete);
        break;

      case 'error':
        this.handleError(new Error(message.mensaje));
        break;
    }
  }

  /**
   * Maneja la asignación de salaId
   */
  private async handleSalaAsignada(salaId: string): Promise<void> {
    console.log('🏠 [KeyPassSDK] Sala asignada:', salaId);
    this.state.salaId = salaId;

    try {
      // Generar claves efímeras
      await this.generateEphemeralKeys();

      // Generar y mostrar QR
      await this.generateAndShowQR();

      // Actualizar estado
      this.updateStatus('Esperando escaneo del celular...');
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Genera claves efímeras ECDSA P-256
   */
  private async generateEphemeralKeys(): Promise<void> {
    console.log('🔐 [KeyPassSDK] Generando claves efímeras...');

    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify']
    );

    this.state.clavePrivada = keyPair.privateKey;

    const publicKeyJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    this.state.clavePublicaJWK = publicKeyJWK as JWK;

    console.log('✅ [KeyPassSDK] Claves generadas');
  }

  /**
   * Genera y muestra el código QR
   */
  private async generateAndShowQR(): Promise<void> {
    if (!this.state.salaId || !this.state.clavePublicaJWK) {
      throw new Error('salaId o clave pública no disponibles');
    }

    console.log('📱 [KeyPassSDK] Generando QR...');

    const qrData = {
      version: '2.0',
      tipo: 'keypass-auth-qr',
      salaId: this.state.salaId,
      clave_publica: this.state.clavePublicaJWK,
      timestamp: Date.now(),
      metadata: {
        algoritmo: 'ECDSA',
        curva: 'P-256',
        proposito: 'autenticacion-delegada',
      },
    };

    const qrString = JSON.stringify(qrData);

    // Ocultar loading, mostrar QR
    const loadingEl = this.container?.querySelector('.keypass-loading');
    const qrEl = this.container?.querySelector('.keypass-qr');

    if (loadingEl && qrEl) {
      loadingEl.setAttribute('style', 'display: none;');
      qrEl.setAttribute('style', 'display: block;');

      // Generar QR
      await QRCode.toCanvas(qrString, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      }).then((canvas) => {
        (qrEl as HTMLElement).innerHTML = '';
        (qrEl as HTMLElement).appendChild(canvas);
      });

      console.log('✅ [KeyPassSDK] QR generado');
    }
  }

  /**
   * Maneja la recepción de delegación del celular
   */
  private async handleDelegacionRecibida(paquete: DelegationResult): Promise<void> {
    console.log('📦 [KeyPassSDK] Delegación recibida');
    this.updateStatus('Verificando delegación...');

    try {
      // Enviar al backend para verificación
      const response = await fetch(`${this.config.serverUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paquete,
          salaId: this.state.salaId,
        }),
      });

      const result: VerifyResponse = await response.json();

      if (result.valido && result.sessionToken) {
        console.log('✅ [KeyPassSDK] Autenticación exitosa');
        this.showSuccess();
        this.config.onSuccess(result.sessionToken);
      } else {
        throw new Error(result.mensaje || 'Verificación fallida');
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Actualiza el texto de estado
   */
  private updateStatus(text: string): void {
    const statusEl = this.container?.querySelector('.keypass-status-text');
    if (statusEl) {
      statusEl.textContent = text;
    }
  }

  /**
   * Muestra el estado de éxito
   */
  private showSuccess(): void {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="keypass-widget">
        <div class="keypass-success">
          <div class="keypass-success-icon">✅</div>
          <h4>¡Autenticación Exitosa!</h4>
          <p>Tu sesión ha sido verificada correctamente</p>
        </div>
      </div>
    `;

    // Cerrar WebSocket
    if (this.state.ws) {
      this.state.ws.close();
      this.state.ws = null;
    }
  }

  /**
   * Maneja errores
   */
  private handleError(error: Error): void {
    console.error('❌ [KeyPassSDK] Error:', error.message);

    if (this.container) {
      this.container.innerHTML = `
        <div class="keypass-widget">
          <div class="keypass-error">
            <div class="keypass-error-icon">❌</div>
            <h4>Error de Autenticación</h4>
            <p>${error.message}</p>
          </div>
        </div>
      `;
    }

    if (this.config.onError) {
      this.config.onError(error);
    }

    // Cerrar WebSocket si está abierto
    if (this.state.ws) {
      this.state.ws.close();
      this.state.ws = null;
    }
  }

  /**
   * Limpia el SDK y libera recursos
   */
  public destroy(): void {
    console.log('🧹 [KeyPassSDK] Limpiando...');

    if (this.state.ws) {
      this.state.ws.close();
      this.state.ws = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
    }

    this.state = {
      ws: null,
      salaId: null,
      clavePrivada: null,
      clavePublicaJWK: null,
      initialized: false,
    };

    // Remover estilos
    const styleEl = document.getElementById('keypass-sdk-styles');
    if (styleEl) {
      styleEl.remove();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIÓN GLOBAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Instancia global del SDK para uso con script tag
 */
const KeyPassSDKGlobal = {
  /**
   * Inicializa el SDK con la configuración proporcionada
   * 
   * @param config - Configuración del SDK
   * @returns Instancia del SDK
   * 
   * @example
   * ```javascript
   * const sdk = KeyPassSDK.init({
   *   elementId: 'keypass-widget',
   *   serverUrl: 'https://localhost:3443',
   *   onSuccess: (token) => {
   *     console.log('Token:', token);
   *     // Guardar token en localStorage, enviar al backend, etc.
   *   },
   *   onError: (error) => {
   *     console.error('Error:', error);
   *   }
   * });
   * ```
   */
  init(config: SDKConfig): KeyPassSDK {
    const sdk = new KeyPassSDK(config);
    sdk.init().catch((error) => {
      if (config.onError) {
        config.onError(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return sdk;
  },
};

// Exportar para uso con módulos ES6
export default KeyPassSDKGlobal;

// Exportar para uso global (window.KeyPassSDK)
if (typeof window !== 'undefined') {
  (window as any).KeyPassSDK = KeyPassSDKGlobal;
}
