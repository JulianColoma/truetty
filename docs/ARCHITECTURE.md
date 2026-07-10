# TrueAuth - Arquitectura del Sistema

**Versión:** 3.0  
**Última actualización:** Julio 2026  
**Estado:** En migración de monolito a serverless

---

## 1. Visión General

TrueAuth es un sistema de autenticación descentralizada que permite a las personas identificarse de forma única y soberana en internet **sin exponer jamás su información biométrica**.

### Principio Fundamental

> La biometría del usuario (FaceID/Huella) se queda estrictamente en el hardware local de su dispositivo para desbloquear su Llave Maestra. TrueAuth usa criptografía asimétrica (ECDSA P-256) para generar firmas efímeras de delegación de confianza temporal. Internet solo recibe una prueba matemática de autenticidad; la privacidad del usuario es absoluta.

### Diferenciador Clave

A diferencia de proyectos centralizados o invasivos como Worldcoin:
- **TrueAuth**: La biometría NUNCA sale del dispositivo. Solo se usa para desbloquear localmente la Llave Maestra.
- **Worldcoin**: Escanea y centraliza datos biométricos (iris) en servidores.

---

## 2. Arquitectura Actual (Monolito v2.1)

### Stack Tecnológico

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTENDS (Vite + TypeScript)                              │
│  ├── notebook/   → SPA desktop: genera QR, recibe delegación│
│  ├── mobile/     → SPA mobile: escanea QR, firma con master │
│  ├── admin/      → Dashboard SPA: CRUD apps, métricas       │
│  └── sdk/        → Widget embebible para terceros            │
├─────────────────────────────────────────────────────────────┤
│  SHARED                                                     │
│  ├── types.ts       → Tipos TS (JWK, QRPayload, WS msgs)   │
│  ├── utils.ts       → Hex/Base64URL/buffer conversions      │
│  ├── keystore.ts    → IKeyStore + WebKeyStore + stubs nativos│
│  └── webcrypto-shim → Fallback con @noble/curves para HTTP  │
├─────────────────────────────────────────────────────────────┤
│  SERVER (Fastify + WebSocket)                                │
│  ├── index.ts          → HTTP REST + WS rooms + static files│
│  ├── index-https.ts    → Duplicado con TLS (⚠️ refactorizar)│
│  ├── rooms.ts          → Gestión de salas efímeras (Map)    │
│  ├── crypto-verifier.ts→ Verificación ECDSA raw→DER + DB    │
│  ├── jwt.ts            → JWT ES256 (jsonwebtoken)           │
│  └── database.ts       → SQLite: sessions, delegations,     │
│                           audit_log, apps                    │
└─────────────────────────────────────────────────────────────┘
```

### Flujo de Autenticación (Actual)

```
┌─────────────────────┐                    ┌─────────────────────┐
│   NOTEBOOK          │                    │   CELULAR           │
│   (Frontend Web)    │                    │   (Frontend Mobile) │
│                     │                    │                     │
│ 1. Conecta WS       │                    │ 4. Escanea QR       │
│ 2. Recibe salaId    │                    │    con cámara       │
│ 3. Muestra QR real  │◄────── QR ────────►│ 5. Firma delegación │
│    con clave pública│     (cámara)       │    con llave maestra│
│ 6. Recibe delegación│                    │ 6. Envía por WS     │
│    por WebSocket    │                    │                     │
└──────────┬──────────┘                    └──────────┬──────────┘
           │                                          │
           │         WebSocket (tiempo real)          │
           └──────────────────┬───────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   SERVIDOR        │
                    │   (Fastify + WS)  │
                    │                   │
                    │ • Gestión de salas│
                    │ • Retransmisión   │
                    │ • POST /api/verify│
                    │ • Verificación    │
                    │   criptográfica   │
                    │ • JWT firmado     │
                    │ • SQLite DB       │
                    │ • Revocación      │
                    └───────────────────┘
```

### Limitaciones de la Arquitectura Actual

1. **Monolito acoplado**: Servidor HTTP + WebSocket + lógica de negocio en un solo proceso
2. **SQLite local**: No escala horizontalmente, requiere persistencia local
3. **Sin multi-tenancy real**: Tabla `apps` existe pero no hay aislamiento de datos por cliente
4. **Infraestructura manual**: Requiere servidor dedicado, no hay auto-scaling
5. **Costo fijo**: Servidor 24/7 aunque no haya tráfico

---

## 3. Arquitectura Objetivo (AWS Serverless v3.0)

### Stack Tecnológico

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTENDS (Vercel + TypeScript)                            │
│  ├── Portal del Desarrollador (SaaS Dashboard)              │
│  ├── SDK trueauth-sdk.js (Widget embebible)                 │
│  ├── Frontend Notebook (SPA desktop)                        │
│  └── Frontend Mobile (SPA mobile-first)                     │
├─────────────────────────────────────────────────────────────┤
│  AWS API GATEWAY (WebSockets)                               │
│  ├── $connect    → Lambda de conexión                       │
│  ├── $disconnect → Lambda de desconexión                    │
│  └── sendMessage → Lambda de mensajería (salas efímeras)    │
├─────────────────────────────────────────────────────────────┤
│  AWS LAMBDAS (TypeScript)                                   │
│  ├── /api/verify         → Verificación criptográfica       │
│  ├── /api/apps           → CRUD de aplicaciones             │
│  ├── /api/metrics        → Métricas de auditoría            │
│  ├── /api/sessions       → Gestión de sesiones              │
│  └── /api/auth           → Autenticación de desarrolladores │
├─────────────────────────────────────────────────────────────┤
│  AMAZON DYNAMODB                                            │
│  ├── Applications (client_id, developer_id, estado, ...)    │
│  ├── AuditLogs (evento, timestamp, client_id, ...)          │
│  ├── Sessions (session_id, sala_id, estado, expiracion, ...)│
│  └── Developers (email, password_hash, created_at, ...)     │
└─────────────────────────────────────────────────────────────┘
```

### Flujo de Autenticación (Objetivo)

```
┌─────────────────────┐                    ┌─────────────────────┐
│   NOTEBOOK          │                    │   CELULAR           │
│   (Vercel)          │                    │   (Vercel)          │
│                     │                    │                     │
│ 1. Conecta WSS      │                    │ 4. Escanea QR       │
│ 2. Recibe salaId    │                    │    con cámara       │
│ 3. Muestra QR real  │◄────── QR ────────►│ 5. Firma delegación │
│    con clave pública│     (cámara)       │    con llave maestra│
│ 6. Recibe delegación│                    │ 6. Envía por WSS    │
│    por WebSocket    │                    │                     │
└──────────┬──────────┘                    └──────────┬──────────┘
           │                                          │
           │         WSS (API Gateway)                │
           └──────────────────┬───────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │   AWS LAMBDA      │
                    │   (Serverless)    │
                    │                   │
                    │ • Gestión de salas│
                    │ • Retransmisión   │
                    │ • Verificación    │
                    │   criptográfica   │
                    │ • JWT firmado     │
                    │ • DynamoDB        │
                    │ • Multi-tenant    │
                    └───────────────────┘
```

### Ventajas de la Arquitectura Serverless

1. **Costo $0 en Free Tier**: 
   - AWS Lambda: 1M requests/mes gratis
   - API Gateway: 1M mensajes/mes gratis
   - DynamoDB: 25GB almacenamiento + 25 RCU/WCU gratis
2. **Auto-scaling automático**: Escala de 0 a miles de requests sin configuración
3. **Multi-tenancy nativo**: Aislamiento por `client_id` en cada request
4. **Sin servidores que mantener**: Infraestructura completamente gestionada
5. **Alta disponibilidad**: AWS maneja redundancia y failover

---

## 4. Componentes del Sistema

### 4.1. Frontend Notebook (SDK Web)

**Propósito**: Script empaquetado (`trueauth-sdk.js`) que inyecta el botón oficial de la plataforma, genera llaves efímeras con WebCrypto API, dibuja un QR real y se conecta vía WSS.

**Tecnologías**:
- Vite + TypeScript
- WebCrypto API (ECDSA P-256)
- QRCode library
- WebSocket nativo

**Responsabilidades**:
1. Generar par de claves efímeras ECDSA P-256
2. Renderizar QR con clave pública + salaId
3. Conectar WebSocket a API Gateway
4. Recibir delegación del celular
5. POST a Lambda `/api/verify`
6. Ejecutar callback `onSuccess(sessionToken)`

### 4.2. Frontend Mobile (App Web de Simulación)

**Propósito**: Interfaz mobile-first en TypeScript para el celular que carga la Llave Maestra (simulando el Secure Enclave), escanea el QR con la cámara, firma el payload de delegación y lo envía por WebSocket.

**Tecnologías**:
- Vite + TypeScript
- html5-qrcode (scanner de cámara)
- WebCrypto API (ECDSA P-256)
- WebSocket nativo

**Responsabilidades**:
1. Cargar/generar Llave Maestra ECDSA P-256 (persistida en localStorage)
2. Escanear QR con cámara del dispositivo
3. Parsear QR → extraer clave pública efímera + salaId
4. Construir payload de delegación con expiración (2h)
5. Firmar payload con Llave Maestra
6. Enviar paquete por WebSocket

### 4.3. Backend Serverless (AWS Cloud Multi-Tenant)

#### AWS API Gateway (WebSockets)

**Propósito**: Gestión de salas efímeras con `connectionId` para retransmitir la delegación en tiempo real.

**Rutas**:
- `$connect`: Lambda que registra conexión en DynamoDB
- `$disconnect`: Lambda que limpia conexión y sala si está vacía
- `sendMessage`: Lambda que retransmite mensajes entre notebook y celular

**Modelo de Datos (DynamoDB)**:
```
Connections Table:
- connectionId (PK)
- salaId (GSI)
- role (notebook | celular)
- connectedAt

Rooms Table:
- salaId (PK)
- notebookConnectionId
- celularConnectionIds (Set)
- createdAt
- lastActivity
```

#### AWS Lambdas (TypeScript)

**Lambda `/api/verify`** (CRÍTICA):
- Recibe paquete de delegación
- Convierte firma de formato Raw (WebCrypto) a DER (Node.js crypto)
- Verifica firma ECDSA P-256 con `node:crypto`
- Valida expiración del payload
- Genera JWT firmado (ES256)
- Registra auditoría en DynamoDB
- Retorna `sessionToken` si es válido

**Lambda `/api/apps`**:
- CRUD de aplicaciones por `developer_id`
- Genera `client_id` único (UUID v4)
- Valida que el desarrollador esté autenticado

**Lambda `/api/metrics`**:
- Consulta `AuditLogs` por `client_id` y rango de fechas
- Retorna métricas agregadas (logins exitosos, fallidos, sesiones activas)

**Lambda `/api/auth`**:
- Autenticación de desarrolladores (email + password)
- Genera JWT de sesión para el portal
- **Dogfooding**: Alternativamente, login con TrueAuth escaneando QR

#### Amazon DynamoDB

**Tabla `Applications`**:
```
PK: client_id (UUID)
SK: developer_id
Attributes:
- nombre (string)
- descripcion (string)
- estado (activa | inactiva)
- created_at (timestamp)
- updated_at (timestamp)
```

**Tabla `AuditLogs`**:
```
PK: client_id
SK: timestamp (ISO 8601)
Attributes:
- evento (login_exitoso | login_fallido | sesion_creada | sesion_revocada)
- sala_id (string)
- session_id (string)
- detalles (map)
- ip_address (string)
```

**Tabla `Sessions`**:
```
PK: session_id (UUID)
SK: client_id
Attributes:
- sala_id (string)
- jwt (string)
- estado (activa | revocada | expirada)
- created_at (timestamp)
- expires_at (timestamp)
- dispositivo_id (string)
```

**Tabla `Developers`**:
```
PK: email
SK: email
Attributes:
- password_hash (string)
- nombre (string)
- created_at (timestamp)
- last_login (timestamp)
```

### 4.4. Portal del Desarrollador (SaaS Dashboard)

**Propósito**: Panel de administración donde las empresas se registran, crean apps para obtener su `client_id` y ven métricas de uso. Para ingresar, los desarrolladores deben autenticarse escaneando el QR con TrueAuth (Dogfooding estricto).

**Tecnologías**:
- Vite + TypeScript + React (o Vue/Svelte)
- TailwindCSS (o similar)
- Chart.js (o Recharts) para métricas
- Fetch API para comunicación con Lambdas

**Vistas**:
1. **Login/Registro**: Formulario tradicional + botón "Login con TrueAuth"
2. **Dashboard**: Métricas generales (logins hoy, sesiones activas, tasa de éxito)
3. **Mis Aplicaciones**: CRUD de apps, copiar `client_id`, ver snippet de integración
4. **Métricas Detalladas**: Gráficos de uso por app, rango de fechas, exportar CSV
5. **Documentación**: Guía de integración del SDK, ejemplos de código

---

## 5. Flujo Criptográfico Detallado

### Fase 1: Notebook (Cliente Web)

1. Se conecta al servidor por **WebSocket**
2. Recibe un `salaId` único (UUID)
3. Genera par de claves efímeras **ECDSA P-256** con `crypto.subtle`
4. Exporta la clave pública en formato **JWK**
5. Renderiza un **código QR real** con la clave pública + salaId
6. Escucha el WebSocket esperando la delegación del celular

**Seguridad:** La clave privada efímera NUNCA sale del navegador.

### Fase 2: Celular (App Móvil)

1. Carga/genera **llave maestra** ECDSA P-256 (persistida en localStorage)
2. Escanea el QR con la **cámara del celular** (html5-qrcode)
3. Parsea el QR → extrae clave pública efímera + salaId
4. Construye payload de delegación: `{ autorizado, expiracion, emitido_en }`
5. Firma el payload con la **llave maestra** usando WebCrypto
6. Se conecta al WebSocket y envía el paquete al salaId
7. Muestra "¡Dispositivo Autorizado!"

**Seguridad:** La llave maestra NUNCA sale del celular.

### Fase 3: Servidor (Backend Lambda)

1. **Gestión de salas WebSocket:**
   - Asigna salaId a la notebook
   - Retransmite delegación del celular a la notebook
2. **Lambda POST /api/verify:**
   - Recibe paquete de delegación
   - Importa clave pública maestra desde JWK
   - **Convierte firma raw → DER** (compatibilidad WebCrypto ↔ Node.js)
   - Verifica firma ECDSA-SHA256 con `crypto.createVerify()`
   - Verifica expiración
   - Genera **sessionToken** (JWT firmado) si todo es válido
   - Registra auditoría en DynamoDB

**Seguridad:** Verificación matemática de la autorización.

### Conversión de Firmas (raw ↔ DER)

**Problema**: WebCrypto genera firmas en formato raw (r‖s, 64 bytes), pero Node.js crypto espera formato DER (ASN.1 SEQUENCE).

**Solución** (implementada en `crypto-verifier.ts`):

```typescript
function rawSignatureToDER(rawSignature: Uint8Array): Buffer {
  // rawSignature tiene 64 bytes: r (32 bytes) || s (32 bytes)
  const r = rawSignature.slice(0, 32);
  const s = rawSignature.slice(32, 64);

  // DER encoding: SEQUENCE { INTEGER r, INTEGER s }
  const encodeInteger = (value: Uint8Array): Buffer => {
    // Si el primer bit es 1, agregar 0x00 al inicio (entero positivo)
    const needsPadding = value[0] & 0x80;
    const length = value.length + (needsPadding ? 1 : 0);
    const buffer = Buffer.alloc(2 + length);
    buffer[0] = 0x02; // INTEGER tag
    buffer[1] = length;
    let offset = 2;
    if (needsPadding) {
      buffer[offset++] = 0x00;
    }
    value.forEach((byte) => {
      buffer[offset++] = byte;
    });
    return buffer;
  };

  const rEncoded = encodeInteger(r);
  const sEncoded = encodeInteger(s);

  // SEQUENCE tag + longitud total + r + s
  const sequence = Buffer.concat([rEncoded, sEncoded]);
  const der = Buffer.alloc(2 + sequence.length);
  der[0] = 0x30; // SEQUENCE tag
  der[1] = sequence.length;
  sequence.copy(der, 2);

  return der;
}
```

---

## 6. Modelo de Seguridad

### Propiedades Garantizadas

✓ **Sin contraseñas:** No hay secretos compartidos  
✓ **Sin tokens estáticos:** Session tokens generados criptográficamente  
✓ **Sin SMS/OTP:** No hay códigos que puedan ser phishing  
✓ **Claves efímeras:** La notebook tiene claves temporales (2h)  
✓ **Llave maestra protegida:** El celular nunca expone su clave privada  
✓ **Verificación matemática:** Prueba criptográfica de autorización  
✓ **Expiración temporal:** Delegaciones con ventana de validez limitada  
✓ **Comunicación en tiempo real:** WebSocket para inmediatez  
✓ **QR con salaId:** Cada QR es único y vincula dispositivos  
✓ **Biometría soberana:** La biometría NUNCA sale del dispositivo  

### Vectores de Ataque Mitigados

| Ataque | Mitigación |
|--------|------------|
| **Phishing** | No hay contraseñas que robar |
| **Man-in-the-Middle** | WebSocket sobre TLS (WSS), firmas criptográficas |
| **Replay attacks** | Delegaciones con expiración (2h) y salaId único |
| **Robo de dispositivo** | Llave maestra protegida por biometría local |
| **Fuga de datos biométricos** | La biometría NUNCA sale del dispositivo |
| **Suplantación de identidad** | Verificación matemática de firma ECDSA |

---

## 7. Comparación con Alternativas

| Característica | TrueAuth | Worldcoin | OAuth 2.0 | Passwords |
|----------------|----------|-----------|-----------|-----------|
| **Biometría** | Local (nunca sale del dispositivo) | Centralizada (iris escaneado) | N/A | N/A |
| **Privacidad** | Absoluta (prueba matemática) | Baja (datos biométricos en servidores) | Media (tokens de acceso) | Baja (contraseñas en DB) |
| **Seguridad** | Criptografía ECDSA P-256 | Criptografía + centralización | Tokens OAuth | Hashing (bcrypt/argon2) |
| **UX** | Escanear QR (2 segundos) | Escanear iris (Orbe) | Redirects + permisos | Recordar contraseñas |
| **Costo** | $0 (serverless free tier) | Alto (hardware Orbe) | Variable | Bajo |
| **Descentralización** | Alta (usuario controla llave) | Baja (Worldcoin controla) | Media (proveedor OAuth) | Baja (servidor controla) |

---

## 8. Roadmap Técnico

### Fase Actual (Sprint 3 Semanas)

**Semana 1**: Backend Serverless (AWS Cloud Multi-Tenant)
- API Gateway WebSockets
- Lambdas TypeScript
- DynamoDB multi-tenant

**Semana 2**: SDK Brandado y Dashboard SaaS
- Portal del Desarrollador
- Panel de Métricas
- SDK `trueauth-sdk.js`

**Semana 3**: Despliegue, Mobile Web y Demo en Vivo
- Optimización Mobile
- Producción Cloud (Vercel + AWS)
- Demo e-commerce ficticia

### Post-MVP (Futuro)

1. **Implementaciones nativas de KeyStore:** Secure Enclave (iOS) y Keystore (Android)
2. **Rotación de claves:** Renovar llaves maestras periódicamente
3. **Multi-dispositivo:** Soporte para múltiples notebooks simultáneas
4. **Rate limiting:** Prevenir abuso del endpoint /api/verify
5. **SDK móvil:** Librerías nativas iOS/Android
6. **OAuth 2.0:** Integración con proveedores de identidad
7. **Biometría avanzada:** Soporte para múltiples modalidades (voz, rostro, huella)

---

## 9. Referencias

- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [ECDSA](https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm)
- [JWK (RFC 7517)](https://tools.ietf.org/html/rfc7517)
- [AWS Lambda](https://aws.amazon.com/lambda/)
- [Amazon DynamoDB](https://aws.amazon.com/dynamodb/)
- [AWS API Gateway WebSockets](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html)
- [Vercel](https://vercel.com/)

---

**Documento mantenido por:** TrueAuth Core Team  
**Contacto:** [julian@trueauth.io](mailto:julian@trueauth.io)
