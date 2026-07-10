# TrueAuth - Especificaciones Técnicas de Entregables

**Versión:** 3.0  
**Última actualización:** Julio 2026

---

## Índice

1. [Entregable 1.1: AWS API Gateway (WebSockets)](#entregable-11-aws-api-gateway-websockets)
2. [Entregable 1.2: AWS Lambdas (TypeScript)](#entregable-12-aws-lambdas-typescript)
3. [Entregable 1.3: Amazon DynamoDB](#entregable-13-amazon-dynamodb)
4. [Entregable 2.1: Portal del Desarrollador](#entregable-21-portal-del-desarrollador)
5. [Entregable 2.2: Panel de Métricas](#entregable-22-panel-de-métricas)
6. [Entregable 2.3: SDK trueauth-sdk.js](#entregable-23-sdk-trueauth-sdkjs)
7. [Entregable 3.1: Optimización Mobile](#entregable-31-optimización-mobile)
8. [Entregable 3.2: Producción Cloud](#entregable-32-producción-cloud)
9. [Entregable 3.3: Entorno Demo](#entregable-33-entorno-demo)

---

## Entregable 1.1: AWS API Gateway (WebSockets)

### Descripción

Configuración del puente en tiempo real para emparejar Notebook y Celular mediante salas efímeras usando `connectionId`.

### Arquitectura

```
┌─────────────────┐         ┌─────────────────┐
│   Notebook      │         │    Celular      │
│   (Browser)     │         │   (Browser)     │
└────────┬────────┘         └────────┬────────┘
         │                           │
         │ WSS                       │ WSS
         │                           │
         └───────────┬───────────────┘
                     │
         ┌───────────▼───────────┐
         │  API Gateway          │
         │  (WebSocket API)      │
         │                       │
         │  Rutas:               │
         │  - $connect           │
         │  - $disconnect        │
         │  - sendMessage        │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │  Lambda Functions     │
         │  - connect.ts         │
         │  - disconnect.ts      │
         │  - sendMessage.ts     │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │  DynamoDB             │
         │  - Connections Table  │
         │  - Rooms Table        │
         └───────────────────────┘
```

### Especificaciones Técnicas

#### API Gateway Configuration

**Nombre**: `trueauth-ws-api`  
**Protocolo**: WebSocket (WSS)  
**Región**: `us-east-1` (menor latencia para LATAM)

**Rutas**:

| Ruta | Tipo | Lambda Asociada | Descripción |
|------|------|-----------------|-------------|
| `$connect` | System | `connect-handler` | Se ejecuta al establecer conexión |
| `$disconnect` | System | `disconnect-handler` | Se ejecuta al cerrar conexión |
| `sendMessage` | Custom | `send-message-handler` | Retransmite mensajes entre clientes |

#### Lambda: `$connect`

**Runtime**: Node.js 18.x  
**Timeout**: 3 segundos  
**Memory**: 128 MB

**Input** (event):
```typescript
{
  requestContext: {
    connectionId: string;
    routeKey: "$connect";
    eventType: "CONNECT";
  };
  queryStringParameters?: {
    role?: "notebook" | "celular";
    salaId?: string;
  };
}
```

**Lógica**:
1. Extraer `connectionId` del `requestContext`
2. Si `role=notebook`:
   - Generar `salaId` (UUID v4)
   - Crear entrada en `Rooms` table
   - Crear entrada en `Connections` table con `role=notebook`
   - Retornar `salaId` al cliente
3. Si `role=celular`:
   - Validar que `salaId` existe en `Rooms` table
   - Crear entrada en `Connections` table con `role=celular`
   - Agregar `connectionId` a la sala
4. Retornar `{ statusCode: 200 }`

**Output**:
```typescript
{
  statusCode: 200,
  body: JSON.stringify({
    salaId: string;
    connectionId: string;
  });
}
```

#### Lambda: `$disconnect`

**Runtime**: Node.js 18.x  
**Timeout**: 3 segundos  
**Memory**: 128 MB

**Input** (event):
```typescript
{
  requestContext: {
    connectionId: string;
    routeKey: "$disconnect";
    eventType: "DISCONNECT";
  };
}
```

**Lógica**:
1. Buscar `connectionId` en `Connections` table
2. Obtener `salaId` y `role`
3. Eliminar entrada de `Connections` table
4. Si `role=notebook`:
   - Marcar sala como inactiva
   - Notificar a celulares conectados (opcional)
5. Si `role=celular`:
   - Remover `connectionId` de la sala
   - Si sala queda vacía, eliminar sala
6. Retornar `{ statusCode: 200 }`

#### Lambda: `sendMessage`

**Runtime**: Node.js 18.x  
**Timeout**: 5 segundos  
**Memory**: 128 MB

**Input** (event):
```typescript
{
  requestContext: {
    connectionId: string;
    routeKey: "sendMessage";
  };
  body: string; // JSON stringified
}
```

**Body** (parseado):
```typescript
{
  action: "delegacion_enviar";
  salaId: string;
  paquete: DelegationResult;
}
```

**Lógica**:
1. Parsear `body` como JSON
2. Validar que `action` sea `delegacion_enviar`
3. Buscar `salaId` en `Rooms` table
4. Obtener `notebookConnectionId` de la sala
5. Usar `@aws-sdk/client-apigatewaymanagementapi` para enviar mensaje a notebook:
   ```typescript
   const apiGw = new ApiGatewayManagementApiClient({
     endpoint: `https://${domainName}/${stage}`,
   });
   
   await apiGw.send(new PostToConnectionCommand({
     ConnectionId: notebookConnectionId,
     Data: JSON.stringify({
       action: "delegacion_recibida",
       paquete: paquete,
     }),
   }));
   ```
6. Enviar ACK al celular:
   ```typescript
   await apiGw.send(new PostToConnectionCommand({
     ConnectionId: connectionId, // celular
     Data: JSON.stringify({
       action: "delegacion_ack",
       success: true,
     }),
   }));
   ```
7. Retornar `{ statusCode: 200 }`

### Modelo de Datos (DynamoDB)

#### Tabla: `Connections`

```typescript
{
  connectionId: string;        // PK
  salaId: string;              // GSI
  role: "notebook" | "celular";
  connectedAt: string;         // ISO 8601
  userAgent?: string;
  ipAddress?: string;
}
```

**Índices**:
- **Primary Key**: `connectionId`
- **GSI**: `salaId-index` (PK: `salaId`, SK: `connectionId`)

#### Tabla: `Rooms`

```typescript
{
  salaId: string;              // PK
  notebookConnectionId: string;
  celularConnectionIds: string[]; // Set<string>
  createdAt: string;           // ISO 8601
  lastActivity: string;        // ISO 8601
  status: "active" | "inactive";
}
```

### Testing

**Herramienta**: `wscat`

```bash
# Instalar wscat
npm install -g wscat

# Conectar como notebook
wscat -c "wss://<api-id>.execute-api.us-east-1.amazonaws.com/prod"

# Esperar mensaje:
# {"salaId":"abc-123","connectionId":"xyz-456"}

# En otra terminal, conectar como celular
wscat -c "wss://<api-id>.execute-api.us-east-1.amazonaws.com/prod?role=celular&salaId=abc-123"

# Enviar mensaje desde celular
> {"action":"delegacion_enviar","salaId":"abc-123","paquete":{...}}

# Verificar que notebook recibe el mensaje
```

### Criterios de Aceptación

- ✅ Notebook se conecta y recibe `salaId` por WebSocket
- ✅ Celular se conecta con `salaId` y se registra en la sala
- ✅ Servidor retransmite mensaje del celular a la notebook
- ✅ ACK se envía al celular después de retransmitir
- ✅ Desconexión limpia recursos en DynamoDB
- ✅ Salas inactivas se eliminan automáticamente (TTL o Lambda periódica)

---

## Entregable 1.2: AWS Lambdas (TypeScript)

### Descripción

Funciones Serverless para manejar conexiones y la Lambda crítica `/api/verify` (conversión de firmas Raw a DER y validación criptográfica ECDSA P-256).

### Lambdas a Implementar

#### 1. Lambda `/api/verify` (CRÍTICA)

**Propósito**: Verificar delegación criptográfica y emitir JWT de sesión.

**Runtime**: Node.js 18.x  
**Timeout**: 10 segundos  
**Memory**: 256 MB

**Input** (API Gateway HTTP):
```typescript
{
  httpMethod: "POST";
  path: "/api/verify";
  headers: {
    "Content-Type": "application/json";
  };
  body: string; // JSON stringified
}
```

**Body** (parseado):
```typescript
{
  salaId: string;
  paquete: {
    payload: {
      autorizado: boolean;
      expiracion: number;        // Unix timestamp
      emitido_en: number;        // Unix timestamp
      dispositivo_id?: string;
    };
    firma: string;               // Hex string (64 bytes raw)
    clave_publica_maestra: JWK;
    algoritmo: "ECDSA";
    curva: "P-256";
  };
}
```

**Lógica**:

1. **Validar input**:
   - Verificar que `salaId` y `paquete` existan
   - Validar estructura de `paquete`

2. **Importar clave pública maestra**:
   ```typescript
   const publicKey = crypto.createPublicKey({
     key: jwkToPEM(paquete.clave_publica_maestra),
     format: 'pem',
   });
   ```

3. **Convertir firma raw → DER** (CRÍTICO):
   ```typescript
   const rawSignature = hexToBuffer(paquete.firma); // 64 bytes
   const derSignature = rawSignatureToDER(rawSignature);
   ```

4. **Verificar firma ECDSA**:
   ```typescript
   const payloadString = JSON.stringify(paquete.payload);
   const verifier = crypto.createVerify('SHA256');
   verifier.update(payloadString);
   verifier.end();
   
   const isValid = verifier.verify(publicKey, derSignature);
   ```

5. **Verificar expiración**:
   ```typescript
   const now = Math.floor(Date.now() / 1000);
   if (paquete.payload.expiracion < now) {
     return { valido: false, mensaje: "Delegación expirada" };
   }
   ```

6. **Generar JWT firmado**:
   ```typescript
   const jwt = jsonwebtoken.sign(
     {
       salaId: salaId,
       dispositivoId: paquete.payload.dispositivo_id,
       clavePublicaEfimera: paquete.clave_publica_efimera,
     },
     privateKey,
     {
       algorithm: 'ES256',
       expiresIn: '2h',
       issuer: 'trueauth',
     }
   );
   ```

7. **Registrar auditoría en DynamoDB**:
   ```typescript
   await dynamodb.put({
     TableName: 'AuditLogs',
     Item: {
       client_id: clientId,
       timestamp: new Date().toISOString(),
       evento: isValid ? 'login_exitoso' : 'login_fallido',
       sala_id: salaId,
       detalles: {
         dispositivo_id: paquete.payload.dispositivo_id,
         mensaje: isValid ? 'Verificación exitosa' : 'Firma inválida',
       },
     },
   });
   ```

8. **Retornar respuesta**:
   ```typescript
   return {
     statusCode: 200,
     body: JSON.stringify({
       valido: isValid,
       mensaje: isValid ? "Verificación exitosa" : "Firma inválida",
       sessionToken: isValid ? jwt : undefined,
       expira_en: isValid ? paquete.payload.expiracion : undefined,
     }),
   };
   ```

**Función Crítica: `rawSignatureToDER()`**:

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
  if (rawSignature.length !== 64) {
    throw new Error('Raw signature must be 64 bytes');
  }

  const r = rawSignature.slice(0, 32);
  const s = rawSignature.slice(32, 64);

  // DER encoding: SEQUENCE { INTEGER r, INTEGER s }
  const encodeInteger = (value: Uint8Array): Buffer => {
    // Si el primer bit es 1, agregar 0x00 al inicio (entero positivo)
    const needsPadding = (value[0] & 0x80) !== 0;
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

**Función Auxiliar: `jwkToPEM()`**:

```typescript
/**
 * Convierte JWK (JSON Web Key) a formato PEM para Node.js crypto.
 * 
 * @param jwk - JWK con clave pública ECDSA P-256
 * @returns PEM string
 */
function jwkToPEM(jwk: JWK): string {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') {
    throw new Error('Only EC P-256 keys are supported');
  }

  // Construir DER manualmente
  // EC Public Key DER structure:
  // SEQUENCE {
  //   SEQUENCE {
  //     OID 1.2.840.10045.2.1 (ecPublicKey)
  //     OID 1.2.840.10045.3.1.7 (prime256v1 / P-256)
  //   }
  //   BIT STRING (public key point)
  // }

  const x = base64UrlToBuffer(jwk.x);
  const y = base64UrlToBuffer(jwk.y);

  // Uncompressed point: 0x04 || x || y
  const publicKeyPoint = Buffer.concat([
    Buffer.from([0x04]),
    x,
    y,
  ]);

  // OIDs
  const ecPublicKeyOID = Buffer.from([
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // 1.2.840.10045.2.1
  ]);
  
  const prime256v1OID = Buffer.from([
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // 1.2.840.10045.3.1.7
  ]);

  // Construir DER
  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, 0x13]), // SEQUENCE, length 19
    ecPublicKeyOID,
    prime256v1OID,
  ]);

  const publicKeyBitString = Buffer.concat([
    Buffer.from([0x03, publicKeyPoint.length + 1, 0x00]), // BIT STRING
    publicKeyPoint,
  ]);

  const der = Buffer.concat([
    Buffer.from([0x30, algorithmIdentifier.length + publicKeyBitString.length]), // SEQUENCE
    algorithmIdentifier,
    publicKeyBitString,
  ]);

  // Convertir a PEM
  const base64 = der.toString('base64');
  const lines = base64.match(/.{1,64}/g) || [];
  
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}
```

#### 2. Lambda `/api/apps`

**Propósito**: CRUD de aplicaciones por `developer_id`.

**Endpoints**:

**POST `/api/apps`** - Crear nueva app

**Input**:
```typescript
{
  httpMethod: "POST";
  headers: {
    "Authorization": "Bearer <jwt>";
  };
  body: string; // JSON stringified
}
```

**Body**:
```typescript
{
  nombre: string;
  descripcion?: string;
}
```

**Lógica**:
1. Verificar JWT del header `Authorization`
2. Extraer `developer_id` del JWT
3. Generar `client_id` (UUID v4)
4. Crear entrada en `Applications` table
5. Retornar `{ client_id, nombre, descripcion, created_at }`

**GET `/api/apps`** - Listar apps del desarrollador

**Input**:
```typescript
{
  httpMethod: "GET";
  headers: {
    "Authorization": "Bearer <jwt>";
  };
  queryStringParameters: {
    developer_id?: string; // Opcional, se extrae del JWT
  };
}
```

**Lógica**:
1. Verificar JWT del header `Authorization`
2. Extraer `developer_id` del JWT
3. Query `Applications` table por `developer_id`
4. Retornar array de apps

#### 3. Lambda `/api/metrics`

**Propósito**: Consultar métricas de auditoría por `client_id` y rango de fechas.

**GET `/api/metrics`**

**Input**:
```typescript
{
  httpMethod: "GET";
  headers: {
    "Authorization": "Bearer <jwt>";
  };
  queryStringParameters: {
    client_id: string;
    from?: string; // ISO 8601
    to?: string;   // ISO 8601
  };
}
```

**Lógica**:
1. Verificar JWT del header `Authorization`
2. Validar que `developer_id` del JWT sea dueño del `client_id`
3. Query `AuditLogs` table:
   - PK: `client_id`
   - SK: rango de `timestamp` (from → to)
4. Agregar métricas:
   - Total logins
   - Logins exitosos
   - Logins fallidos
   - Tasa de éxito (%)
   - Logins por día (array)
5. Retornar métricas

**Output**:
```typescript
{
  statusCode: 200;
  body: JSON.stringify({
    total_logins: number;
    logins_exitosos: number;
    logins_fallidos: number;
    tasa_exito: number; // 0-100
    logins_por_dia: Array<{
      fecha: string; // YYYY-MM-DD
      exitosos: number;
      fallidos: number;
    }>;
  });
}
```

#### 4. Lambda `/api/sessions`

**Propósito**: Gestión de sesiones activas.

**GET `/api/sessions`** - Listar sesiones activas

**Input**:
```typescript
{
  httpMethod: "GET";
  headers: {
    "Authorization": "Bearer <jwt>";
  };
  queryStringParameters: {
    client_id: string;
  };
}
```

**Lógica**:
1. Verificar JWT
2. Query `Sessions` table por `client_id` donde `estado=activa`
3. Retornar array de sesiones

**POST `/api/sessions/revoke`** - Revocar sesión

**Input**:
```typescript
{
  httpMethod: "POST";
  headers: {
    "Authorization": "Bearer <jwt>";
  };
  body: string; // JSON stringified
}
```

**Body**:
```typescript
{
  session_id: string;
}
```

**Lógica**:
1. Verificar JWT
2. Validar que `developer_id` sea dueño de la sesión
3. Update `Sessions` table: `estado=revocada`
4. Registrar en `AuditLogs`
5. Retornar `{ success: true }`

#### 5. Lambda `/api/auth`

**Propósito**: Autenticación de desarrolladores.

**POST `/api/auth/register`** - Registrar desarrollador

**Input**:
```typescript
{
  httpMethod: "POST";
  body: string; // JSON stringified
}
```

**Body**:
```typescript
{
  email: string;
  password: string;
  nombre: string;
}
```

**Lógica**:
1. Validar email y password (mínimo 8 caracteres)
2. Hash password con bcrypt (10 rounds)
3. Crear entrada en `Developers` table
4. Retornar `{ success: true, developer_id }`

**POST `/api/auth/login`** - Login tradicional

**Input**:
```typescript
{
  httpMethod: "POST";
  body: string; // JSON stringified
}
```

**Body**:
```typescript
{
  email: string;
  password: string;
}
```

**Lógica**:
1. Buscar desarrollador por email en `Developers` table
2. Verificar password con bcrypt
3. Generar JWT con `developer_id`
4. Retornar `{ token, developer_id, nombre }`

**POST `/api/auth/login-trueauth`** - Login con TrueAuth (dogfooding)

**Input**:
```typescript
{
  httpMethod: "POST";
  body: string; // JSON stringified
}
```

**Body**:
```typescript
{
  sessionToken: string; // JWT de TrueAuth
  email: string;
}
```

**Lógica**:
1. Verificar `sessionToken` (JWT de TrueAuth)
2. Buscar desarrollador por email
3. Generar JWT de portal con `developer_id`
4. Retornar `{ token, developer_id, nombre }`

### Testing

**Herramienta**: `aws lambda invoke` o Postman

```bash
# Invocar Lambda /api/verify
aws lambda invoke \
  --function-name trueauth-verify \
  --payload '{"salaId":"abc-123","paquete":{...}}' \
  response.json

# Ver respuesta
cat response.json
```

### Criterios de Aceptación

- ✅ Lambda `/api/verify` verifica firma ECDSA correctamente
- ✅ Conversión raw→DER funciona (test unitario pasa)
- ✅ JWT generado es válido y verificable
- ✅ Auditoría se registra en DynamoDB
- ✅ Todas las Lambdas responden en < 500ms
- ✅ Manejo de errores robusto (try-catch, validaciones)

---

## Entregable 1.3: Amazon DynamoDB

### Descripción

Tabla 'Applications' (validación de client_id activos de empresas) y Tabla 'AuditLogs' (registro histórico y métricas).

### Esquema de Tablas

#### Tabla: `Applications`

**Propósito**: Almacenar aplicaciones registradas por desarrolladores.

```typescript
{
  client_id: string;        // PK (UUID v4)
  developer_id: string;     // SK (email del desarrollador)
  nombre: string;
  descripcion?: string;
  estado: "activa" | "inactiva";
  created_at: string;       // ISO 8601
  updated_at: string;       // ISO 8601
}
```

**Configuración**:
- **Primary Key**: `client_id` (HASH) + `developer_id` (RANGE)
- **GSI**: `developer_id-index` (PK: `developer_id`, SK: `created_at`)
- **Capacity Mode**: On-demand (pago por uso, ideal para Free Tier)

**Queries Comunes**:
```typescript
// Obtener app por client_id
const app = await dynamodb.get({
  TableName: 'Applications',
  Key: {
    client_id: 'abc-123',
    developer_id: 'user@example.com',
  },
});

// Listar apps de un desarrollador
const apps = await dynamodb.query({
  TableName: 'Applications',
  IndexName: 'developer_id-index',
  KeyConditionExpression: 'developer_id = :devId',
  ExpressionAttributeValues: {
    ':devId': 'user@example.com',
  },
});
```

#### Tabla: `AuditLogs`

**Propósito**: Registro histórico de eventos de autenticación.

```typescript
{
  client_id: string;        // PK
  timestamp: string;        // SK (ISO 8601)
  evento: "login_exitoso" | "login_fallido" | "sesion_creada" | "sesion_revocada";
  sala_id: string;
  session_id?: string;
  detalles: {
    dispositivo_id?: string;
    ip_address?: string;
    user_agent?: string;
    mensaje?: string;
  };
}
```

**Configuración**:
- **Primary Key**: `client_id` (HASH) + `timestamp` (RANGE)
- **GSI**: `session_id-index` (PK: `session_id`, SK: `timestamp`)
- **TTL**: Habilitado en campo `ttl` (eliminar logs > 90 días)
- **Capacity Mode**: On-demand

**Queries Comunes**:
```typescript
// Obtener logs de un cliente en rango de fechas
const logs = await dynamodb.query({
  TableName: 'AuditLogs',
  KeyConditionExpression: 'client_id = :clientId AND #ts BETWEEN :from AND :to',
  ExpressionAttributeNames: {
    '#ts': 'timestamp',
  },
  ExpressionAttributeValues: {
    ':clientId': 'abc-123',
    ':from': '2026-07-01T00:00:00Z',
    ':to': '2026-07-31T23:59:59Z',
  },
});
```

#### Tabla: `Sessions`

**Propósito**: Almacenar sesiones activas y revocadas.

```typescript
{
  session_id: string;       // PK (UUID v4)
  client_id: string;        // SK
  sala_id: string;
  jwt: string;
  estado: "activa" | "revocada" | "expirada";
  created_at: string;       // ISO 8601
  expires_at: string;       // ISO 8601
  dispositivo_id?: string;
  ttl: number;              // Unix timestamp para TTL
}
```

**Configuración**:
- **Primary Key**: `session_id` (HASH) + `client_id` (RANGE)
- **GSI**: `client_id-index` (PK: `client_id`, SK: `created_at`)
- **GSI**: `sala_id-index` (PK: `sala_id`, SK: `session_id`)
- **TTL**: Habilitado en campo `ttl` (eliminar sesiones expiradas)
- **Capacity Mode**: On-demand

#### Tabla: `Developers`

**Propósito**: Almacenar cuentas de desarrolladores.

```typescript
{
  email: string;            // PK
  password_hash: string;    // bcrypt hash
  nombre: string;
  created_at: string;       // ISO 8601
  last_login?: string;      // ISO 8601
}
```

**Configuración**:
- **Primary Key**: `email` (HASH)
- **Capacity Mode**: On-demand

#### Tabla: `Connections`

**Propósito**: Mapear `connectionId` de WebSocket a `salaId`.

```typescript
{
  connectionId: string;     // PK
  salaId: string;           // GSI
  role: "notebook" | "celular";
  connectedAt: string;      // ISO 8601
  userAgent?: string;
  ipAddress?: string;
  ttl: number;              // Unix timestamp (24h)
}
```

**Configuración**:
- **Primary Key**: `connectionId` (HASH)
- **GSI**: `salaId-index` (PK: `salaId`, SK: `connectionId`)
- **TTL**: Habilitado en campo `ttl` (eliminar conexiones > 24h)
- **Capacity Mode**: On-demand

#### Tabla: `Rooms`

**Propósito**: Almacenar salas efímeras de WebSocket.

```typescript
{
  salaId: string;           // PK
  notebookConnectionId: string;
  celularConnectionIds: string[]; // Set<string>
  createdAt: string;        // ISO 8601
  lastActivity: string;     // ISO 8601
  status: "active" | "inactive";
  ttl: number;              // Unix timestamp (1h)
}
```

**Configuración**:
- **Primary Key**: `salaId` (HASH)
- **TTL**: Habilitado en campo `ttl` (eliminar salas > 1h)
- **Capacity Mode**: On-demand

### Creación de Tablas (AWS CLI)

```bash
# Crear tabla Applications
aws dynamodb create-table \
  --table-name Applications \
  --attribute-definitions \
    AttributeName=client_id,AttributeType=S \
    AttributeName=developer_id,AttributeType=S \
  --key-schema \
    AttributeName=client_id,KeyType=HASH \
    AttributeName=developer_id,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# Crear tabla AuditLogs
aws dynamodb create-table \
  --table-name AuditLogs \
  --attribute-definitions \
    AttributeName=client_id,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema \
    AttributeName=client_id,KeyType=HASH \
    AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# Crear tabla Sessions
aws dynamodb create-table \
  --table-name Sessions \
  --attribute-definitions \
    AttributeName=session_id,AttributeType=S \
    AttributeName=client_id,AttributeType=S \
  --key-schema \
    AttributeName=session_id,KeyType=HASH \
    AttributeName=client_id,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST

# Crear tabla Developers
aws dynamodb create-table \
  --table-name Developers \
  --attribute-definitions \
    AttributeName=email,AttributeType=S \
  --key-schema \
    AttributeName=email,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# Crear tabla Connections
aws dynamodb create-table \
  --table-name Connections \
  --attribute-definitions \
    AttributeName=connectionId,AttributeType=S \
  --key-schema \
    AttributeName=connectionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# Crear tabla Rooms
aws dynamodb create-table \
  --table-name Rooms \
  --attribute-definitions \
    AttributeName=salaId,AttributeType=S \
  --key-schema \
    AttributeName=salaId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST
```

### Estimación de Costos

**Free Tier de DynamoDB**:
- 25 GB de almacenamiento
- 25 RCU (Read Capacity Units) provisionadas
- 25 WCU (Write Capacity Units) provisionadas

**Modo On-Demand**:
- $1.25 por millón de escrituras
- $0.25 por millón de lecturas

**Estimación para 10,000 autenticaciones/mes**:
- Escrituras: 10,000 (AuditLogs) + 10,000 (Sessions) = 20,000 writes
- Lecturas: 10,000 (verify) + 10,000 (queries) = 20,000 reads
- **Costo estimado**: < $0.10/mes (dentro del Free Tier)

### Criterios de Aceptación

- ✅ Todas las tablas creadas en DynamoDB
- ✅ Queries funcionan correctamente
- ✅ TTL elimina sesiones expiradas automáticamente
- ✅ Índices secundarios permiten consultas eficientes
- ✅ Costo estimado < $0.50/mes (Free Tier)

---

## Entregable 2.1: Portal del Desarrollador

### Descripción

SPA moderna de registro y administración. El acceso requiere loguearse con TrueAuth usando su propio QR (Dogfooding).

### Stack Tecnológico

- **Framework**: Vite + TypeScript + React 18
- **Estilos**: TailwindCSS
- **Router**: React Router v6
- **HTTP Client**: Fetch API (o Axios)
- **State Management**: React Context (o Zustand)
- **Formularios**: React Hook Form + Zod (validación)

### Estructura de Archivos

```
src/portal/
├── index.html
├── main.tsx
├── App.tsx
├── components/
│   ├── Layout.tsx
│   ├── Sidebar.tsx
│   ├── Header.tsx
│   ├── ProtectedRoute.tsx
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Card.tsx
│   └── Modal.tsx
├── pages/
│   ├── Login.tsx
│   ├── Register.tsx
│   ├── Dashboard.tsx
│   ├── Apps.tsx
│   ├── Metrics.tsx
│   └── Docs.tsx
├── hooks/
│   ├── useAuth.ts
│   └── useApi.ts
├── services/
│   └── api.ts
├── contexts/
│   └── AuthContext.tsx
└── styles/
    └── globals.css
```

### Vistas

#### 1. `/login`

**Componentes**:
- Formulario de login (email + password)
- Botón "Login con TrueAuth"
- QR para escanear (si se elige login con TrueAuth)

**Lógica**:
```typescript
const handleLogin = async (email: string, password: string) => {
  const response = await api.post('/api/auth/login', { email, password });
  if (response.token) {
    localStorage.setItem('auth_token', response.token);
    navigate('/dashboard');
  }
};

const handleTrueAuthLogin = (sessionToken: string) => {
  // TrueAuth SDK callback
  api.post('/api/auth/login-trueauth', { sessionToken, email })
    .then(response => {
      localStorage.setItem('auth_token', response.token);
      navigate('/dashboard');
    });
};
```

#### 2. `/register`

**Componentes**:
- Formulario de registro (nombre, email, password, confirmar password)
- Validación en tiempo real

**Validaciones**:
- Email: formato válido
- Password: mínimo 8 caracteres, 1 mayúscula, 1 número
- Confirmar password: debe coincidir

#### 3. `/dashboard`

**Componentes**:
- Cards con métricas clave:
  - Logins hoy
  - Sesiones activas
  - Tasa de éxito (%)
  - Total de apps
- Gráfico de actividad últimos 7 días
- Lista de apps recientes

**Lógica**:
```typescript
useEffect(() => {
  api.get('/api/metrics?client_id=all&from=7days')
    .then(data => setMetrics(data));
}, []);
```

#### 4. `/apps`

**Componentes**:
- Tabla con todas las apps del desarrollador
- Botón "Crear Nueva App" (abre modal)
- Acciones por fila:
  - Copiar `client_id`
  - Editar
  - Desactivar

**Modal de Crear App**:
- Input: Nombre de la app
- Input: Descripción (opcional)
- Botón: Crear

**Lógica**:
```typescript
const handleCreateApp = async (nombre: string, descripcion: string) => {
  const response = await api.post('/api/apps', { nombre, descripcion });
  setApps([...apps, response]);
  closeModal();
};
```

#### 5. `/metrics`

**Componentes**:
- Selector de app (dropdown)
- Selector de rango de fechas
- Gráficos:
  - Logins por día (line chart)
  - Sesiones activas (bar chart)
  - Tasa de éxito (pie chart)
- Botón "Exportar CSV"

**Lógica**:
```typescript
const handleFilterChange = (clientId: string, from: string, to: string) => {
  api.get(`/api/metrics?client_id=${clientId}&from=${from}&to=${to}`)
    .then(data => setMetrics(data));
};
```

#### 6. `/docs`

**Componentes**:
- Guía de integración del SDK
- Snippet de código copiable
- Ejemplos en diferentes frameworks (React, Vue, vanilla JS)

**Contenido**:
```html
<h2>Integración Rápida</h2>
<p>Agrega TrueAuth a tu sitio en 3 pasos:</p>

<h3>1. Incluye el SDK</h3>
<pre><code>&lt;script src="https://cdn.trueauth.io/trueauth-sdk.min.js"&gt;&lt;/script&gt;</code></pre>

<h3>2. Agrega el contenedor</h3>
<pre><code>&lt;div id="trueauth-button"&gt;&lt;/div&gt;</code></pre>

<h3>3. Inicializa</h3>
<pre><code>
TrueAuth.init({
  elementId: 'trueauth-button',
  clientId: 'YOUR_CLIENT_ID',
  serverUrl: 'https://api.trueauth.io',
  onSuccess: (token) => {
    console.log('Autenticado:', token);
  },
});
</code></pre>
```

### Autenticación

**Context**: `AuthContext.tsx`

```typescript
interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithTrueAuth: (sessionToken: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>(...);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('auth_token'));

  const login = async (email, password) => {
    const response = await api.post('/api/auth/login', { email, password });
    setToken(response.token);
    setUser(response.user);
    localStorage.setItem('auth_token', response.token);
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('auth_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
};
```

**Protected Route**:

```typescript
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated } = useAuth();
  
  if (!isAuthenticated) {
    return <Navigate to="/login" />;
  }
  
  return children;
};
```

### Criterios de Aceptación

- ✅ Desarrollador puede registrarse y hacer login
- ✅ Login con TrueAuth funciona (dogfooding)
- ✅ Dashboard muestra métricas reales de DynamoDB
- ✅ CRUD de apps funcional
- ✅ Métricas se actualizan en tiempo real
- ✅ UI responsive (mobile-friendly)
- ✅ Rutas protegidas requieren autenticación

---

## Entregable 2.2: Panel de Métricas

### Descripción

Sección donde el cliente genera su client_id y visualiza gráficos de logins exitosos consumiendo la Lambda de auditoría.

### Componentes

#### `<MetricsChart>`

**Props**:
```typescript
interface MetricsChartProps {
  data: Array<{
    label: string;
    value: number;
  }>;
  type: 'line' | 'bar' | 'pie';
  title: string;
  color?: string;
}
```

**Implementación** (Chart.js):
```typescript
import { Line, Bar, Pie } from 'react-chartjs-2';

const MetricsChart = ({ data, type, title, color = '#3b82f6' }) => {
  const chartData = {
    labels: data.map(d => d.label),
    datasets: [{
      label: title,
      data: data.map(d => d.value),
      borderColor: color,
      backgroundColor: color + '40',
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
  };

  if (type === 'line') return <Line data={chartData} options={options} />;
  if (type === 'bar') return <Bar data={chartData} options={options} />;
  if (type === 'pie') return <Pie data={chartData} options={options} />;
};
```

#### `<MetricsCard>`

**Props**:
```typescript
interface MetricsCardProps {
  title: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string; // "+12%"
  icon?: React.ReactNode;
}
```

**Implementación**:
```typescript
const MetricsCard = ({ title, value, trend, trendValue, icon }) => {
  const trendColor = trend === 'up' ? 'text-green-500' : 
                    trend === 'down' ? 'text-red-500' : 
                    'text-gray-500';

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{title}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {trendValue && (
            <p className={`text-sm ${trendColor} mt-1`}>
              {trend === 'up' ? '↑' : trend === 'down' ? '↓' : ''} {trendValue}
            </p>
          )}
        </div>
        {icon && <div className="text-gray-400">{icon}</div>}
      </div>
    </div>
  );
};
```

#### `<DateRangeSelector>`

**Props**:
```typescript
interface DateRangeSelectorProps {
  value: { from: string; to: string };
  onChange: (range: { from: string; to: string }) => void;
}
```

**Implementación**:
```typescript
const DateRangeSelector = ({ value, onChange }) => {
  const presets = [
    { label: 'Hoy', days: 0 },
    { label: '7 días', days: 7 },
    { label: '30 días', days: 30 },
    { label: '90 días', days: 90 },
  ];

  const handlePresetClick = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days);
    
    onChange({
      from: from.toISOString(),
      to: to.toISOString(),
    });
  };

  return (
    <div className="flex gap-2">
      {presets.map(preset => (
        <button
          key={preset.label}
          onClick={() => handlePresetClick(preset.days)}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded"
        >
          {preset.label}
        </button>
      ))}
    </div>
  );
};
```

### Exportación CSV

**Helper**: `utils/csv.ts`

```typescript
export const exportToCSV = (data: any[], filename: string) => {
  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  const csvContent = [
    headers.join(','),
    ...data.map(row => headers.map(h => row[h]).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};
```

### Criterios de Aceptación

- ✅ Gráficos renderizan datos reales de DynamoDB
- ✅ Filtros (fecha, app) actualizan gráficos en tiempo real
- ✅ Exportación CSV funciona correctamente
- ✅ Gráficos son responsive y accesibles
- ✅ Performance: < 1s en renderizar gráficos

---

## Entregable 2.3: SDK trueauth-sdk.js

### Descripción

Script optimizado que inyecta el botón oficial ("Verificar con TrueAuth"), maneja loaders, capturas de error y limpia el DOM al terminar.

### API Pública

```typescript
interface TrueAuthConfig {
  elementId: string;           // ID del contenedor
  clientId: string;            // client_id de la app
  serverUrl: string;           // URL del API Gateway
  onSuccess: (token: string) => void;
  onError?: (error: Error) => void;
  theme?: 'light' | 'dark';   // Tema del widget
  language?: 'es' | 'en';     // Idioma
}

interface TrueAuthSDK {
  init: (config: TrueAuthConfig) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    TrueAuth: TrueAuthSDK;
  }
}
```

### Uso

**Con `<script>` tag**:
```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.trueauth.io/trueauth-sdk.min.js"></script>
</head>
<body>
  <div id="trueauth-button"></div>
  
  <script>
    TrueAuth.init({
      elementId: 'trueauth-button',
      clientId: 'YOUR_CLIENT_ID',
      serverUrl: 'https://api.trueauth.io',
      onSuccess: (token) => {
        console.log('Autenticado:', token);
        // Enviar token a tu backend
      },
      onError: (error) => {
        console.error('Error:', error);
      },
      theme: 'light',
      language: 'es',
    });
  </script>
</body>
</html>
```

**Con npm**:
```bash
npm install trueauth-sdk
```

```typescript
import TrueAuth from 'trueauth-sdk';

TrueAuth.init({
  elementId: 'trueauth-button',
  clientId: 'YOUR_CLIENT_ID',
  serverUrl: 'https://api.trueauth.io',
  onSuccess: (token) => {
    console.log('Autenticado:', token);
  },
});
```

### Estados de UI

```typescript
type SDKState = 'idle' | 'loading' | 'qr' | 'success' | 'error';
```

**idle**: Botón visible
```html
<button class="trueauth-btn">
  <img src="logo.svg" />
  Verificar con TrueAuth
</button>
```

**loading**: Spinner mientras conecta WebSocket
```html
<div class="trueauth-loading">
  <div class="spinner"></div>
  Conectando...
</div>
```

**qr**: Modal con QR visible
```html
<div class="trueauth-modal">
  <div class="trueauth-qr-container">
    <canvas id="trueauth-qr"></canvas>
    <p>Escanea este código con tu celular</p>
  </div>
  <button class="trueauth-cancel">Cancelar</button>
</div>
```

**success**: Mensaje de éxito
```html
<div class="trueauth-success">
  <div class="checkmark">✓</div>
  <p>¡Identidad verificada!</p>
</div>
```

**error**: Mensaje de error
```html
<div class="trueauth-error">
  <div class="error-icon">✗</div>
  <p>Error: Conexión fallida</p>
  <button class="trueauth-retry">Reintentar</button>
</div>
```

### Flujo Interno

```typescript
class TrueAuthSDKImpl {
  private config: TrueAuthConfig;
  private state: SDKState = 'idle';
  private ws: WebSocket | null = null;
  private salaId: string | null = null;
  private clavePrivada: CryptoKey | null = null;
  private clavePublicaJWK: JsonWebKey | null = null;

  async init(config: TrueAuthConfig) {
    this.config = config;
    this.renderButton();
  }

  private renderButton() {
    const container = document.getElementById(this.config.elementId);
    if (!container) throw new Error(`Element #${this.config.elementId} not found`);

    container.innerHTML = `
      <button class="trueauth-btn trueauth-btn-${this.config.theme || 'light'}">
        <svg class="trueauth-logo">...</svg>
        Verificar con TrueAuth
      </button>
    `;

    container.querySelector('.trueauth-btn')?.addEventListener('click', () => {
      this.startAuth();
    });
  }

  private async startAuth() {
    this.setState('loading');
    
    try {
      // 1. Conectar WebSocket
      await this.connectWebSocket();
      
      // 2. Generar claves efímeras
      await this.generateKeys();
      
      // 3. Mostrar QR
      this.setState('qr');
      this.renderQR();
      
      // 4. Esperar delegación (manejado en handleWSMessage)
    } catch (error) {
      this.handleError(error);
    }
  }

  private async connectWebSocket() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`${this.config.serverUrl}/ws`);
      
      this.ws.onopen = () => resolve(null);
      this.ws.onerror = (e) => reject(new Error('WebSocket connection failed'));
      this.ws.onmessage = (e) => this.handleWSMessage(e);
    });
  }

  private async generateKeys() {
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign', 'verify']
    );
    
    this.clavePrivada = keyPair.privateKey;
    this.clavePublicaJWK = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  }

  private renderQR() {
    const qrPayload = {
      version: '3.0',
      tipo: 'trueauth-qr',
      salaId: this.salaId,
      clave_publica: this.clavePublicaJWK,
      timestamp: Date.now(),
    };

    const container = document.getElementById(this.config.elementId);
    container.innerHTML = `
      <div class="trueauth-modal">
        <canvas id="trueauth-qr"></canvas>
        <p>Escanea este código con tu celular</p>
        <button class="trueauth-cancel">Cancelar</button>
      </div>
    `;

    QRCode.toCanvas(
      document.getElementById('trueauth-qr'),
      JSON.stringify(qrPayload),
      { width: 256 }
    );

    container.querySelector('.trueauth-cancel')?.addEventListener('click', () => {
      this.destroy();
    });
  }

  private async handleWSMessage(event: MessageEvent) {
    const message = JSON.parse(event.data);
    
    if (message.action === 'sala_asignada') {
      this.salaId = message.salaId;
    }
    
    if (message.action === 'delegacion_recibida') {
      await this.verifyDelegation(message.paquete);
    }
  }

  private async verifyDelegation(paquete: any) {
    try {
      const response = await fetch(`${this.config.serverUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salaId: this.salaId,
          paquete: paquete,
        }),
      });

      const result = await response.json();
      
      if (result.valido) {
        this.setState('success');
        this.config.onSuccess(result.sessionToken);
        setTimeout(() => this.destroy(), 2000);
      } else {
        throw new Error(result.mensaje);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  private handleError(error: any) {
    this.setState('error');
    this.config.onError?.(error);
  }

  private setState(state: SDKState) {
    this.state = state;
    // Re-renderizar según estado
  }

  destroy() {
    this.ws?.close();
    const container = document.getElementById(this.config.elementId);
    if (container) {
      container.innerHTML = '';
    }
    this.setState('idle');
  }
}
```

### Build de Producción

**Vite Config** (`vite.sdk.config.ts`):
```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/sdk/trueauth-sdk.ts',
      name: 'TrueAuth',
      fileName: (format) => `trueauth-sdk.${format}.js`,
      formats: ['umd', 'es'],
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
      },
    },
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
  },
});
```

**Build**:
```bash
npm run build:sdk
```

**Output**:
- `dist/trueauth-sdk.umd.js` (UMD para `<script>` tag)
- `dist/trueauth-sdk.es.js` (ES Module para npm)

### Criterios de Aceptación

- ✅ SDK se carga con `<script>` tag
- ✅ Botón "Verificar con TrueAuth" se renderiza
- ✅ Flujo completo funciona (QR → scan → verify → token)
- ✅ Errores se manejan gracefully
- ✅ DOM se limpia al terminar
- ✅ Bundle < 50KB gzipped
- ✅ Documentación completa

---

## Entregable 3.1: Optimización Mobile

### Descripción

Interfaz web-mobile que permite al usuario visualizar y gestionar el historial de notebooks que tiene actualmente autorizadas.

### Vistas

#### 1. Home (`/mobile`)

**Componentes**:
- Header con logo TrueAuth
- Botón "Escanear QR" (grande, centrado)
- Lista de "Dispositivos Autorizados"

**Layout**:
```html
<div class="mobile-container">
  <header class="mobile-header">
    <img src="logo.svg" alt="TrueAuth" />
    <button class="profile-btn">👤</button>
  </header>
  
  <main class="mobile-main">
    <button class="scan-btn">
      <svg>...</svg>
      Escanear QR
    </button>
    
    <section class="devices-section">
      <h2>Dispositivos Autorizados</h2>
      <div class="devices-list">
        <!-- DeviceCard components -->
      </div>
    </section>
  </main>
</div>
```

#### 2. Scanner (`/mobile/scan`)

**Componentes**:
- Scanner QR fullscreen
- Instrucciones overlay
- Botón cancelar

**Lógica**:
```typescript
import { Html5Qrcode } from 'html5-qrcode';

const startScanner = async () => {
  const scanner = new Html5Qrcode('scanner');
  
  await scanner.start(
    { facingMode: 'environment' },
    { fps: 10, qrbox: 250 },
    (qrCode) => {
      const payload = JSON.parse(qrCode);
      handleQRScanned(payload);
      scanner.stop();
    },
    (error) => {
      console.error('Scan error:', error);
    }
  );
};
```

#### 3. Perfil (`/mobile/profile`)

**Componentes**:
- Avatar (iniciales o imagen)
- Nombre/email
- Estadísticas (dispositivos autorizados, logins este mes)
- Botón "Cerrar sesión"

### Componente: `<DeviceCard>`

**Props**:
```typescript
interface DeviceCardProps {
  device: {
    session_id: string;
    dispositivo_id: string;
    nombre?: string;
    created_at: string;
    expires_at: string;
  };
  onRevoke: (sessionId: string) => void;
}
```

**Implementación**:
```typescript
const DeviceCard = ({ device, onRevoke }) => {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleRevoke = () => {
    if (showConfirm) {
      onRevoke(device.session_id);
    } else {
      setShowConfirm(true);
      setTimeout(() => setShowConfirm(false), 3000);
    }
  };

  return (
    <div class="device-card">
      <div class="device-info">
        <div class="device-icon">💻</div>
        <div class="device-details">
          <h3>{device.nombre || 'Notebook'}</h3>
          <p>Autorizado: {formatDate(device.created_at)}</p>
          <p>Expira: {formatDate(device.expires_at)}</p>
        </div>
      </div>
      <button 
        class={`revoke-btn ${showConfirm ? 'confirm' : ''}`}
        onClick={handleRevoke}
      >
        {showConfirm ? '¿Confirmar?' : 'Revocar'}
      </button>
    </div>
  );
};
```

### Estilos Mobile-First

```css
/* Base styles (mobile) */
.mobile-container {
  max-width: 420px;
  margin: 0 auto;
  min-height: 100vh;
  background: #f5f5f5;
}

.mobile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background: white;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

.scan-btn {
  width: 100%;
  padding: 1.5rem;
  font-size: 1.25rem;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 1rem;
}

.device-card {
  background: white;
  padding: 1rem;
  margin: 0.5rem 1rem;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}

/* Touch-friendly */
button {
  min-height: 44px;
  min-width: 44px;
}

/* Animations */
.scan-btn:active {
  transform: scale(0.98);
}

.device-card {
  transition: transform 0.2s;
}

.device-card:active {
  transform: scale(0.98);
}
```

### Criterios de Aceptación

- ✅ UI es responsive y touch-friendly
- ✅ Scanner QR funciona en mobile
- ✅ Lista de dispositivos se carga desde DynamoDB
- ✅ Revocación funciona correctamente
- ✅ Performance: < 2s en cargar en 4G
- ✅ Compatible con iOS Safari y Android Chrome

---

## Entregable 3.2: Producción Cloud

### Descripción

Deploy de frontends en Vercel apuntando a endpoints reales de AWS (HTTPS/WSS).

### Configuración de Vercel

**`vercel.json`** (global):
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "env": {
    "VITE_API_URL": "https://api.trueauth.io",
    "VITE_WS_URL": "wss://api.trueauth.io"
  }
}
```

**`src/portal/vercel.json`**:
```json
{
  "rewrites": [
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

### Deploy Commands

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

### Configuración de AWS API Gateway

**CORS**:
```typescript
// En cada Lambda HTTP
return {
  statusCode: 200,
  headers: {
    'Access-Control-Allow-Origin': 'https://portal.trueauth.io',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  },
  body: JSON.stringify(response),
};
```

### Variables de Entorno en Vercel

```bash
vercel env add VITE_API_URL production
# Ingresar: https://abc123.execute-api.us-east-1.amazonaws.com/prod

vercel env add VITE_WS_URL production
# Ingresar: wss://abc123.execute-api.us-east-1.amazonaws.com/prod
```

### Criterios de Aceptación

- ✅ Todos los frontends desplegados en Vercel
- ✅ Frontends apuntan a AWS API Gateway (HTTPS/WSS)
- ✅ Flujo completo funciona en producción
- ✅ No hay errores de CORS
- ✅ Performance: Lighthouse score > 90
- ✅ Costo: $0 (Vercel Hobby + AWS Free Tier)

---

## Entregable 3.3: Entorno Demo

### Descripción

Creación de una web e-commerce ficticia conectada al SDK para probar el flujo de TrueAuth en vivo desde cualquier lugar del mundo.

### E-commerce: "TechStore Demo"

**Stack**:
- Vite + TypeScript
- TailwindCSS
- TrueAuth SDK

### Páginas

#### 1. Home (`/`)

**Contenido**:
- Hero section con banner
- Productos destacados (grid de 4 productos)
- CTA: "Ver catálogo completo"

#### 2. Productos (`/products`)

**Contenido**:
- Grid de productos (12-15 productos)
- Filtros por categoría
- Búsqueda

**Componente `<ProductCard>`**:
```typescript
interface ProductCardProps {
  product: {
    id: string;
    nombre: string;
    precio: number;
    imagen: string;
    categoria: string;
  };
  onAddToCart: (productId: string) => void;
}
```

#### 3. Detalle de Producto (`/product/:id`)

**Contenido**:
- Imagen grande
- Nombre, precio, descripción
- Botón "Agregar al carrito"
- Productos relacionados

#### 4. Carrito (`/cart`)

**Contenido**:
- Lista de items en carrito
- Cantidad por item (+/-)
- Total
- Botón "Ir a checkout"

#### 5. Checkout (`/checkout`)

**Contenido**:
- Resumen de orden
- **Botón "Verificar con TrueAuth"** (SDK integrado)
- Formulario de envío (después de verificar identidad)
- Botón "Confirmar Compra" (habilitado después de TrueAuth)

**Integración TrueAuth**:
```typescript
const Checkout = () => {
  const [verified, setVerified] = useState(false);
  const [sessionToken, setSessionToken] = useState(null);

  useEffect(() => {
    TrueAuth.init({
      elementId: 'trueauth-checkout',
      clientId: 'DEMO_CLIENT_ID',
      serverUrl: 'https://api.trueauth.io',
      onSuccess: (token) => {
        setVerified(true);
        setSessionToken(token);
      },
    });
  }, []);

  return (
    <div>
      <h1>Checkout</h1>
      
      <OrderSummary />
      
      {!verified ? (
        <div>
          <p>Para completar tu compra, verifica tu identidad:</p>
          <div id="trueauth-checkout"></div>
        </div>
      ) : (
        <div>
          <div class="verified-badge">
            ✓ Identidad verificada
          </div>
          <ShippingForm />
          <button class="confirm-btn">
            Confirmar Compra
          </button>
        </div>
      )}
    </div>
  );
};
```

### Productos Ficticios

```typescript
const products = [
  {
    id: '1',
    nombre: 'MacBook Pro 14"',
    precio: 1999,
    imagen: 'https://images.unsplash.com/photo-1517336714731',
    categoria: 'Laptops',
  },
  {
    id: '2',
    nombre: 'iPhone 15 Pro',
    precio: 999,
    imagen: 'https://images.unsplash.com/photo-1592286927505',
    categoria: 'Celulares',
  },
  {
    id: '3',
    nombre: 'AirPods Pro',
    precio: 249,
    imagen: 'https://images.unsplash.com/photo-1600294037681',
    categoria: 'Audio',
  },
  // ... 12 productos más
];
```

### Deploy

```bash
cd demo
vercel --prod
```

**Dominio**: `demo.trueauth.io` (opcional)

### Criterios de Aceptación

- ✅ E-commerce ficticio es funcional
- ✅ TrueAuth SDK está integrado en checkout
- ✅ Flujo completo funciona desde cualquier lugar
- ✅ Deploy en Vercel exitoso
- ✅ Demo es presentable a inversores/clientes

---

**Documento mantenido por:** TrueAuth Core Team  
**Última actualización:** Julio 2026
