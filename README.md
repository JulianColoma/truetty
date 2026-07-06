# KeyPass Auth - MVP v2.1

**Sistema de Autenticación Descentralizada con Portabilidad Criptográfica**

MVP completo que emula el flujo de vinculación multidispositivo de WhatsApp Web, pero para autenticación web pura usando la **WebCrypto API** nativa del navegador, con comunicación en tiempo real vía **WebSocket** y códigos **QR reales**.

## 🎯 Objetivo

Permitir que un usuario autentique una sesión web en una notebook escaneando un código QR con su celular, sin contraseñas, sin tokens compartidos, sin SMS. La seguridad se basa puramente en criptografía de curva elíptica (ECDSA P-256).

## 🏗️ Arquitectura v2.1

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
                    │ • Session tokens  │
                    └───────────────────┘
```

## 🚀 Inicio Rápido

### Requisitos
- **Node.js 18+** (para WebCrypto API nativa)
- **npm** o **yarn**
- **Cámara web** en el celular (para escanear QR)

### Instalación

```bash
npm install
```

### Compilar Frontends

```bash
npx vite build
```

### Iniciar Servidor (localhost)

```bash
npm run dev
```

El servidor arranca en `http://localhost:3000` con:
- 📱 **Notebook:** `http://localhost:3000/notebook/`
- 📱 **Celular:** `http://localhost:3000/mobile/`
- 🔌 **WebSocket:** `ws://localhost:3000/ws`
- 🔐 **API Health:** `http://localhost:3000/api/health`
- 🔐 **API Verify:** `http://localhost:3000/api/verify`

### Iniciar Servidor (Red Local - Dispositivos Reales)

```bash
# Obtener IPs y URLs de acceso
npm run ip

# Iniciar servidor accesible desde la red
npm run dev:network
```

Ver [docs/TESTING_REAL_DEVICES.md](./docs/TESTING_REAL_DEVICES.md) para guía completa.

### Prueba Automatizada (sin navegadores)

```bash
npm run test:e2e
```

## 📱 Uso Manual (con navegadores)

### Modo 1: Testing en localhost (mismo dispositivo)

#### Paso 1: Abrir la Notebook
1. Abrí `http://localhost:3000/notebook/` en tu computadora
2. La página genera claves efímeras y muestra un **código QR real**
3. Esperá a que el celular escanee el QR

#### Paso 2: Escanear con el Celular
1. Abrí `http://localhost:3000/mobile/` en tu celular
2. Permití el acceso a la cámara
3. Apuntá al código QR de la notebook
4. El celular firma la delegación y la envía automáticamente
5. La notebook se actualiza mostrando "¡Sesión Autorizada!"

### Modo 2: Testing con dispositivos reales (red local)

Ver [docs/TESTING_REAL_DEVICES.md](./docs/TESTING_REAL_DEVICES.md) para instrucciones detalladas.

**Resumen rápido:**
```bash
# 1. Obtener IP de la notebook
npm run ip

# 2. Iniciar servidor accesible desde la red
npm run dev:network

# 3. En la notebook: http://<IP>:3000/notebook/
# 4. En el celular: http://<IP>:3000/mobile/
# 5. Escanear QR con el celular
```

## 🔐 Flujo Criptográfico Completo

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

### Fase 3: Servidor (Backend)
1. **Gestión de salas WebSocket:**
   - Asigna salaId a la notebook
   - Retransmite delegación del celular a la notebook
2. **Endpoint POST /api/verify:**
   - Recibe paquete de delegación
   - Importa clave pública maestra desde JWK
   - Convierte firma raw → DER (compatibilidad WebCrypto ↔ Node.js)
   - Verifica firma ECDSA-SHA256 con `crypto.createVerify()`
   - Verifica expiración
   - Genera **sessionToken** si todo es válido

**Seguridad:** Verificación matemática de la autorización.

## 📁 Estructura del Proyecto

```
keypass-auth/
├── src/
│   ├── shared/
│   │   ├── types.ts              # Tipos TypeScript (JWK, WebSocket, etc.)
│   │   └── utils.ts              # Utilidades criptográficas
│   ├── server/
│   │   ├── index.ts              # Servidor Fastify principal
│   │   ├── rooms.ts              # Gestión de salas WebSocket
│   │   └── crypto-verifier.ts    # Verificación criptográfica
│   ├── frontend/
│   │   ├── notebook/
│   │   │   ├── index.html        # Vista de la notebook
│   │   │   ├── main.ts           # Lógica del frontend notebook
│   │   │   └── styles.css        # Estilos
│   │   └── mobile/
│   │       ├── index.html        # Vista del celular
│   │       ├── main.ts           # Lógica del frontend mobile
│   │       └── styles.css        # Estilos mobile-first
│   ├── client/                   # MVP v1 (demo CLI)
│   ├── mobile/                   # MVP v1 (demo CLI)
│   ├── backend/                  # MVP v1 (demo CLI)
│   ├── demo.ts                   # Demo v1
│   └── test-e2e.ts               # Prueba end-to-end automatizada
├── dist/
│   └── frontend/                 # Frontends compilados (Vite)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## 🔑 Conceptos Criptográficos

### ECDSA P-256
- Algoritmo de firma digital basado en curvas elípticas
- Seguridad equivalente a RSA-3072 con claves mucho más pequeñas
- Propiedades: integridad, autenticidad, no repudio

### JWK (JSON Web Key)
- Estándar RFC 7517 para representar claves en JSON
- Permite interoperabilidad entre sistemas
- Contiene coordenadas X, Y de la clave pública

### Conversión de Firmas (raw ↔ DER)
- **WebCrypto:** genera firmas en formato raw (r‖s, 64 bytes)
- **Node.js crypto:** espera formato DER (ASN.1 SEQUENCE)
- El servidor convierte entre formatos para compatibilidad

### WebSocket Rooms
- Cada sesión tiene un `salaId` único (UUID)
- La notebook se conecta y crea la sala
- El celular se une a la sala usando el salaId del QR
- El servidor retransmite mensajes entre ellos

## 🛡️ Propiedades de Seguridad

✓ **Sin contraseñas:** No hay secretos compartidos  
✓ **Sin tokens estáticos:** Session tokens generados criptográficamente  
✓ **Sin SMS/OTP:** No hay códigos que puedan ser phishing  
✓ **Claves efímeras:** La notebook tiene claves temporales (2h)  
✓ **Llave maestra protegida:** El celular nunca expone su clave privada  
✓ **Verificación matemática:** Prueba criptográfica de autorización  
✓ **Expiración temporal:** Delegaciones con ventana de validez limitada  
✓ **Comunicación en tiempo real:** WebSocket para inmediatez  
✓ **QR con salaId:** Cada QR es único y vincula dispositivos  

## 📊 Comparación con WhatsApp Web

| Característica | WhatsApp Web | KeyPass Auth v2 |
|----------------|--------------|-----------------|
| Vinculación | QR + Signal | QR + ECDSA P-256 |
| Comunicación | HTTP polling | WebSocket tiempo real |
| Claves maestras | Secure Enclave | localStorage (demo) |
| Claves efímeras | En la web | En la web |
| Verificación | Servidor centralizado | Backend del cliente |
| QR | Código propietario | JSON estándar |
| Estándar | Protocolo propietario | WebCrypto + WebSocket |
| Session tokens | JWT propietario | Base64 (extensible a JWT) |

## 🔮 Próximos Pasos (Post-MVP)

1. **Secure Enclave/Keystore:** Mover llave maestra a hardware seguro
2. **JWT firmado:** Reemplazar sessionToken con JWT real
3. **Rotación de claves:** Renovar llaves maestras periódicamente
4. **Revocación:** Endpoint para invalidar sesiones activas
5. **Multi-dispositivo:** Soporte para múltiples notebooks simultáneas
6. **Persistencia:** Base de datos para sesiones y auditoría
7. **HTTPS/WSS:** TLS para producción
8. **Rate limiting:** Prevenir abuso del endpoint /api/verify
9. **SDK móvil:** Librerías nativas iOS/Android
10. **SDK web:** Widget embebible para cualquier sitio

## 🧪 Testing

### Prueba Automatizada
```bash
npx tsx src/test-e2e.ts
```
Simula el flujo completo sin navegadores y verifica:
- Conexión WebSocket
- Generación de claves
- Firma de delegación
- Retransmisión por servidor
- Verificación criptográfica
- Generación de session token

### Demo CLI (v1)
```bash
npm run demo
```
Ejecuta la demostración original sin frontends.

## 📚 Referencias

- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [ECDSA](https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm)
- [JWK (RFC 7517)](https://tools.ietf.org/html/rfc7517)
- [Fastify](https://www.fastify.io/)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [html5-qrcode](https://github.com/mebjas/html5-qrcode)
- [Vite](https://vitejs.dev/)

## 📄 Licencia

MIT

## 👨‍💻 Autor

Desarrollado como MVP educativo para demostrar autenticación descentralizada con criptografía de curva elíptica, WebSocket y códigos QR reales.

---

**Nota:** Este es un MVP educativo. Para producción:
- Mover llaves a Secure Enclave/Keystore
- Implementar HTTPS/WSS
- Usar JWT firmados para session tokens
- Realizar auditoría de seguridad profesional
- Implementar rate limiting y protección contra ataques
