# TrueAuth - Guía de Desarrollo

**Versión:** 3.0  
**Última actualización:** Julio 2026

---

## Índice

1. [Setup del Entorno](#setup-del-entorno)
2. [Estructura del Proyecto](#estructura-del-proyecto)
3. [Convenciones de Código](#convenciones-de-código)
4. [Flujo de Trabajo Git](#flujo-de-trabajo-git)
5. [Testing](#testing)
6. [Debugging](#debugging)
7. [Deploy](#deploy)
8. [Troubleshooting](#troubleshooting)

---

## Setup del Entorno

### Requisitos Previos

- **Node.js 18+** (LTS recomendado)
- **npm 9+** o **yarn 1.22+**
- **Git 2.30+**
- **AWS CLI 2.x** (para Semana 1+)
- **Vercel CLI** (para Semana 3)

### Instalación

```bash
# Clonar repositorio
git clone https://github.com/tu-usuario/trueauth.git
cd trueauth

# Instalar dependencias
npm install

# Configurar variables de entorno (crear .env)
cp .env.example .env
```

### Variables de Entorno

**`.env`** (desarrollo local):
```bash
# Servidor
PORT=3000
HOST=0.0.0.0

# JWT
JWT_PRIVATE_KEY=./keys/jwt-private.pem
JWT_PUBLIC_KEY=./keys/jwt-public.pem

# Base de datos (local)
DATABASE_URL=./data/keypass.db

# AWS (producción)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Frontend
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
```

### Comandos Disponibles

```bash
# Desarrollo
npm run dev              # Iniciar servidor (localhost:3000)
npm run dev:https        # Iniciar servidor HTTPS (localhost:3443)
npm run dev:frontend     # Iniciar Vite dev server (frontend)
npm run dev:network      # Iniciar servidor accesible desde red local

# Build
npm run build            # Build completo (server + frontend)
npm run build:server     # Build solo server (TypeScript)
npm run build:frontend   # Build solo frontend (Vite)
npm run build:sdk        # Build SDK (trueauth-sdk.js)

# Testing
npm run test:e2e         # Test end-to-end (requiere servidor corriendo)
npm run test:jwt         # Test de JWT
npm run test:revoke      # Test de revocación
npm run test:keystore    # Test de KeyStore

# Utilidades
npm run ip               # Mostrar IP local para testing en red
npm run gen-certs        # Generar certificados TLS auto-firmados
npm run demo             # Ejecutar demo CLI (v1 legacy)
```

### Setup de AWS CLI

```bash
# Instalar AWS CLI
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Configurar credenciales
aws configure
# AWS Access Key ID: [tu-access-key]
# AWS Secret Access Key: [tu-secret-key]
# Default region name: us-east-1
# Default output format: json

# Verificar configuración
aws sts get-caller-identity
```

### Setup de Vercel CLI

```bash
# Instalar Vercel CLI
npm install -g vercel

# Login
vercel login

# Verificar
vercel whoami
```

---

## Estructura del Proyecto

```
trueauth/
├── src/
│   ├── shared/              # Código compartido (tipos, utils)
│   │   ├── types.ts         # Tipos TypeScript
│   │   ├── utils.ts         # Funciones utilitarias
│   │   └── keystore.ts      # Abstracción KeyStore
│   │
│   ├── server/              # Backend (Fastify + WebSocket)
│   │   ├── index.ts         # Servidor principal
│   │   ├── index-https.ts   # Servidor HTTPS
│   │   ├── rooms.ts         # Gestión de salas WebSocket
│   │   ├── crypto-verifier.ts # Verificación criptográfica
│   │   ├── jwt.ts           # Generación/verificación JWT
│   │   └── database.ts      # SQLite (migrar a DynamoDB)
│   │
│   ├── frontend/            # Frontends (Vite + TypeScript)
│   │   ├── notebook/        # SPA desktop
│   │   ├── mobile/          # SPA mobile
│   │   ├── admin/           # Dashboard admin (legacy)
│   │   └── shared/          # Código compartido frontend
│   │
│   ├── sdk/                 # SDK para terceros
│   │   ├── trueauth-sdk.ts  # SDK principal
│   │   ├── example.html     # Ejemplo de uso
│   │   └── README.md        # Documentación SDK
│   │
│   ├── portal/              # Portal del Desarrollador (SaaS)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── services/
│   │
│   ├── aws/                 # Lambdas AWS (Semana 1+)
│   │   ├── websocket/       # Lambdas WebSocket
│   │   ├── lambdas/         # Lambdas HTTP
│   │   ├── dynamodb/        # Schema y helpers
│   │   └── shared/          # Código compartido AWS
│   │
│   └── demo/                # E-commerce demo (Semana 3)
│       ├── index.html
│       ├── main.ts
│       ├── pages/
│       └── components/
│
├── docs/                    # Documentación
│   ├── ARCHITECTURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── DELIVERABLES.md
│   ├── DEVELOPMENT_GUIDE.md
│   ├── AWS_SETUP.md
│   ├── HTTPS_SETUP.md
│   ├── TESTING_REAL_DEVICES.md
│   └── KEYSTORE_GUIDE.md
│
├── keys/                    # Claves JWT (gitignored)
├── data/                    # SQLite DB (gitignored)
├── certs/                   # Certificados TLS (gitignored)
├── dist/                    # Build output (gitignored)
│
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vite.sdk.config.ts
├── vercel.json
└── README.md
```

---

## Convenciones de Código

### TypeScript

**Estilo**: TypeScript estricto con `strict: true` en `tsconfig.json`.

**Nomenclatura**:
- **Variables/Funciones**: camelCase (`generateKeys`, `salaId`)
- **Clases/Interfaces**: PascalCase (`TrueAuthSDK`, `DelegationPayload`)
- **Constantes**: UPPER_SNAKE_CASE (`MAX_CONNECTIONS`)
- **Tipos**: PascalCase (`JWK`, `QRPayload`)
- **Enums**: PascalCase (`SDKState`)

**Ejemplo**:
```typescript
// ✅ Correcto
interface DelegationPayload {
  autorizado: boolean;
  expiracion: number;
  emitido_en: number;
}

const generateEphemeralKeys = async (): Promise<CryptoKeyPair> => {
  return await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify']
  );
};

// ❌ Incorrecto
interface delegation_payload { ... }
const GenerateKeys = async () => { ... }
```

### Comentarios

**Idioma**: Español (para mantener consistencia con el equipo).

**Estilo**:
```typescript
/**
 * Convierte firma ECDSA de formato raw (r||s) a formato DER (ASN.1).
 * 
 * WebCrypto genera firmas en formato raw: 64 bytes (r: 32 bytes || s: 32 bytes)
 * Node.js crypto espera formato DER: SEQUENCE { INTEGER r, INTEGER s }
 * 
 * @param rawSignature - Uint8Array de 64 bytes (r||s)
 * @returns Buffer con firma en formato DER
 */
function rawSignatureToDER(rawSignature: Uint8Array): Buffer {
  // ...
}

// Comentario inline para lógica compleja
const needsPadding = (value[0] & 0x80) !== 0; // Si primer bit es 1, agregar padding
```

### Organización de Archivos

**Un archivo = una responsabilidad**:
```typescript
// ✅ Correcto: crypto-verifier.ts
export const verificarPaquete = async (paquete, salaId) => { ... }

// ❌ Incorrecto: todo en un archivo
export const verificarPaquete = ...
export const generarJWT = ...
export const conectarDB = ...
```

**Exportaciones**:
```typescript
// ✅ Named exports (preferido)
export const verificarFirma = () => { ... }
export const verificarExpiracion = () => { ... }

// ✅ Default export (solo para clases principales)
export default class TrueAuthSDK { ... }
```

### Manejo de Errores

**Siempre usar try-catch**:
```typescript
// ✅ Correcto
try {
  const result = await verificarPaquete(paquete, salaId);
  return result;
} catch (error) {
  console.error('Error verificando paquete:', error);
  return { valido: false, mensaje: 'Error interno' };
}

// ❌ Incorrecto
const result = await verificarPaquete(paquete, salaId);
return result; // Sin manejo de errores
```

**Tipos de error personalizados**:
```typescript
class TrueAuthError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'TrueAuthError';
  }
}

class SignatureVerificationError extends TrueAuthError {
  constructor(message: string) {
    super(message, 'SIGNATURE_INVALID');
  }
}
```

### Logging

**Niveles**:
```typescript
console.log('🔵 INFO: Servidor iniciado en puerto 3000');
console.warn('🟡 WARN: Sala inactiva detectada');
console.error('🔴 ERROR: Firma inválida');
```

**Estructura**:
```typescript
console.log('🔵 INFO:', {
  evento: 'delegacion_recibida',
  salaId: salaId,
  timestamp: new Date().toISOString(),
});
```

---

## Flujo de Trabajo Git

### Branches

```bash
main                    # Producción (estable)
├── develop             # Desarrollo (integración)
├── feature/xxx         # Features nuevas
├── fix/xxx             # Bug fixes
└── release/x.x.x       # Releases
```

### Convención de Commits

**Formato**: `<tipo>: <descripción>`

**Tipos**:
- `feat`: Nueva funcionalidad
- `fix`: Bug fix
- `refactor`: Refactorización
- `docs`: Documentación
- `test`: Tests
- `chore`: Tareas de mantenimiento

**Ejemplos**:
```bash
feat: implementar Lambda /api/verify con conversión raw→DER
fix: corregir error de CORS en API Gateway
refactor: extraer lógica de salas a módulo separado
docs: agregar guía de setup de AWS
test: agregar tests unitarios para rawSignatureToDER
chore: actualizar dependencias
```

### Pull Requests

**Template**:
```markdown
## Descripción
Breve descripción de los cambios.

## Tipo de Cambio
- [ ] Feature nueva
- [ ] Bug fix
- [ ] Refactorización
- [ ] Documentación

## Testing
- [ ] Tests unitarios pasan
- [ ] Tests E2E pasan
- [ ] Probado en dispositivos reales

## Screenshots (si aplica)
[Agregar screenshots]

## Checklist
- [ ] Código sigue convenciones del proyecto
- [ ] Documentación actualizada
- [ ] Sin console.log en producción
```

---

## Testing

### Tests Unitarios

**Framework**: Scripts personalizados (no Jest/Vitest por ahora).

**Ejecutar**:
```bash
npm run test:jwt         # Test de JWT
npm run test:revoke      # Test de revocación
npm run test:keystore    # Test de KeyStore
```

**Ejemplo de test**:
```typescript
// test-jwt.ts
import { generateJWT, verifyJWT } from './src/server/jwt';

const testJWT = async () => {
  console.log('🧪 Test: Generar JWT');
  
  const payload = { salaId: 'test-123' };
  const token = await generateJWT(payload);
  
  console.log('✅ JWT generado:', token.substring(0, 50) + '...');
  
  console.log('🧪 Test: Verificar JWT');
  const decoded = await verifyJWT(token);
  
  if (decoded.salaId === 'test-123') {
    console.log('✅ JWT verificado correctamente');
  } else {
    console.error('❌ JWT inválido');
    process.exit(1);
  }
};

testJWT();
```

### Tests E2E

**Requisito**: Servidor corriendo en `localhost:3000`.

**Ejecutar**:
```bash
# Terminal 1: Iniciar servidor
npm run dev

# Terminal 2: Ejecutar test
npm run test:e2e
```

**Qué prueba**:
1. Conexión WebSocket
2. Generación de claves
3. Firma de delegación
4. Retransmisión por servidor
5. Verificación criptográfica
6. Generación de JWT

### Testing en Dispositivos Reales

**Setup**:
```bash
# Obtener IP local
npm run ip

# Iniciar servidor accesible desde red
npm run dev:network
```

**Probar**:
1. Notebook: `http://<IP>:3000/notebook/`
2. Celular: `http://<IP>:3000/mobile/`
3. Escanear QR con celular

Ver [docs/TESTING_REAL_DEVICES.md](./TESTING_REAL_DEVICES.md) para guía completa.

---

## Debugging

### Debugging de WebSocket

**Herramienta**: `wscat`

```bash
# Instalar
npm install -g wscat

# Conectar
wscat -c ws://localhost:3000/ws

# Enviar mensaje
> {"action":"delegacion_enviar","salaId":"abc-123","paquete":{...}}
```

### Debugging de Lambdas

**AWS CloudWatch Logs**:
```bash
# Ver logs de Lambda
aws logs tail /aws/lambda/trueauth-verify --follow
```

**Invocación local**:
```bash
# Invocar Lambda con payload
aws lambda invoke \
  --function-name trueauth-verify \
  --payload '{"salaId":"test","paquete":{...}}' \
  response.json

# Ver respuesta
cat response.json
```

### Debugging de Frontend

**Chrome DevTools**:
- **Console**: Ver logs y errores
- **Network**: Inspeccionar requests HTTP/WS
- **Application**: Ver localStorage, cookies
- **Sources**: Breakpoints en código

**WebSocket debugging**:
```javascript
// En Console de DevTools
const ws = new WebSocket('ws://localhost:3000/ws');
ws.onmessage = (e) => console.log('WS Message:', e.data);
ws.send(JSON.stringify({ action: 'test' }));
```

---

## Deploy

### Deploy Local (Desarrollo)

```bash
# Build
npm run build

# Iniciar servidor de producción
node dist/server/index.js
```

### Deploy AWS (Semana 1+)

**Lambdas**:
```bash
# Empaquetar Lambda
zip -r lambda-verify.zip src/aws/lambdas/verify.ts node_modules/

# Actualizar Lambda
aws lambda update-function-code \
  --function-name trueauth-verify \
  --zip-file fileb://lambda-verify.zip
```

**API Gateway**:
```bash
# Deploy API
aws apigateway create-deployment \
  --rest-api-id abc123 \
  --stage-name prod
```

### Deploy Vercel (Semana 3)

```bash
# Deploy Portal
cd src/portal
vercel --prod

# Deploy Frontend Notebook
cd src/frontend/notebook
vercel --prod

# Deploy Frontend Mobile
cd src/frontend/mobile
vercel --prod
```

---

## Troubleshooting

### Problema: WebSocket no conecta

**Síntomas**:
```
WebSocket connection to 'ws://localhost:3000/ws' failed
```

**Soluciones**:
1. Verificar que servidor está corriendo: `npm run dev`
2. Verificar puerto: `lsof -i :3000`
3. Verificar firewall: permitir puerto 3000
4. Probar con `wscat -c ws://localhost:3000/ws`

### Problema: Firma inválida

**Síntomas**:
```json
{
  "valido": false,
  "mensaje": "Firma inválida"
}
```

**Soluciones**:
1. Verificar que payload es idéntico (JSON.stringify canónico)
2. Verificar conversión raw→DER (test unitario)
3. Verificar que clave pública es correcta (JWK)
4. Agregar logs en `crypto-verifier.ts`

### Problema: CORS error

**Síntomas**:
```
Access to fetch at 'http://localhost:3000/api/verify' from origin 'http://localhost:5173' 
has been blocked by CORS policy
```

**Soluciones**:
1. Verificar que `@fastify/cors` está configurado
2. Agregar origen a lista de permitidos:
   ```typescript
   await fastify.register(cors, {
     origin: ['http://localhost:5173', 'http://localhost:3000'],
   });
   ```

### Problema: QR no se escanea

**Síntomas**:
- Celular no detecta QR
- Error: "No QR code found"

**Soluciones**:
1. Verificar iluminación adecuada
2. Ajustar distancia (20-30 cm)
3. Verificar que QR es válido (usar app de QR genérica)
4. Aumentar tamaño del QR en notebook
5. Verificar que cámara tiene permisos

### Problema: JWT expirado

**Síntomas**:
```json
{
  "error": "TokenExpiredError",
  "message": "jwt expired"
}
```

**Soluciones**:
1. Verificar `expiresIn` en configuración JWT
2. Sincronizar relojes del servidor (NTP)
3. Aumentar tiempo de expiración (solo para desarrollo)

### Problema: DynamoDB throttling

**Síntomas**:
```
ProvisionedThroughputExceededException
```

**Soluciones**:
1. Cambiar a modo On-Demand (pago por uso)
2. Implementar retry con exponential backoff
3. Optimizar queries (usar índices secundarios)

---

## Recursos Adicionales

### Documentación Oficial

- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [AWS Lambda](https://docs.aws.amazon.com/lambda/)
- [Amazon DynamoDB](https://docs.aws.amazon.com/dynamodb/)
- [AWS API Gateway](https://docs.aws.amazon.com/apigateway/)
- [Vercel](https://vercel.com/docs)

### Herramientas Recomendadas

- **VS Code Extensions**:
  - TypeScript Hero
  - Prettier
  - ESLint
  - AWS Toolkit
  - Vercel

- **CLI Tools**:
  - `wscat`: WebSocket client
  - `httpie`: HTTP client (alternativa a curl)
  - `jq`: JSON processor

### Comunidades

- [AWS re:Post](https://repost.aws/)
- [Vercel Community](https://github.com/vercel/vercel/discussions)
- [TypeScript Discord](https://discord.gg/typescript)

---

**Documento mantenido por:** TrueAuth Core Team  
**Última actualización:** Julio 2026
