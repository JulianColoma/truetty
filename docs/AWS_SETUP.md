# TrueAuth - Guía de Configuración AWS (Costo $0)

**Versión:** 3.0  
**Última actualización:** Julio 2026  
**Objetivo:** Configurar infraestructura serverless en AWS aprovechando el Free Tier

---

## Índice

1. [Resumen de Costos](#resumen-de-costos)
2. [Prerequisitos](#prerequisitos)
3. [Configuración Inicial de AWS](#configuración-inicial-de-aws)
4. [Amazon DynamoDB](#amazon-dynamodb)
5. [AWS Lambda](#aws-lambda)
6. [API Gateway (HTTP)](#api-gateway-http)
7. [API Gateway (WebSocket)](#api-gateway-websocket)
8. [IAM Roles y Permisos](#iam-roles-y-permisos)
9. [Monitoreo y Alertas](#monitoreo-y-alertas)
10. [Optimización de Costos](#optimización-de-costos)

---

## Resumen de Costos

### Free Tier de AWS (12 meses gratis)

| Servicio | Free Tier | Uso Estimado TrueAuth | Costo Estimado |
|----------|-----------|----------------------|----------------|
| **AWS Lambda** | 1M requests/mes + 400,000 GB-seg | ~50,000 requests/mes | **$0** |
| **API Gateway** | 1M mensajes/mes (WebSocket) + 1M calls/mes (HTTP) | ~100,000 calls/mes | **$0** |
| **DynamoDB** | 25GB storage + 25 RCU/WCU provisionadas | ~5GB storage | **$0** |
| **CloudWatch Logs** | 5GB ingest + 5GB storage | ~1GB/mes | **$0** |

**Costo Total Estimado**: **$0/mes** (dentro del Free Tier)

### Límites a Monitorear

- **Lambda**: 1M requests/mes (alerta al 80%)
- **API Gateway**: 1M mensajes/mes (alerta al 80%)
- **DynamoDB**: 25GB storage (alerta al 80%)

---

## Prerequisitos

### 1. Crear Cuenta AWS

1. Ir a [aws.amazon.com](https://aws.amazon.com/)
2. Click en "Create an AWS Account"
3. Completar registro (requiere tarjeta de crédito, pero no se cobra si te mantienes en Free Tier)
4. Verificar email y teléfono
5. Seleccionar plan "Basic" (gratis)

### 2. Instalar AWS CLI

**Linux**:
```bash
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Verificar instalación
aws --version
# aws-cli/2.15.0 Python/3.11.6 Linux/6.5.0
```

**macOS**:
```bash
curl "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "AWSCLIV2.pkg"
sudo installer -pkg AWSCLIV2.pkg -target /

# Verificar instalación
aws --version
```

**Windows**:
```powershell
# Descargar MSI desde:
# https://awscli.amazonaws.com/AWSCLIV2.msi

# Instalar con doble-click

# Verificar instalación
aws --version
```

### 3. Crear Access Keys

1. Ir a [AWS Console](https://console.aws.amazon.com/)
2. Click en tu nombre (arriba derecha) → "Security credentials"
3. Scroll a "Access keys" → Click "Create access key"
4. Seleccionar "Command Line Interface (CLI)"
5. Click "Next" → "Create access key"
6. **IMPORTANTE**: Guardar `Access Key ID` y `Secret Access Key` en lugar seguro
7. Descargar archivo `.csv` (backup)

---

## Configuración Inicial de AWS

### Configurar AWS CLI

```bash
aws configure
```

**Input**:
```
AWS Access Key ID [None]: AKIAIOSFODNN7EXAMPLE
AWS Secret Access Key [None]: wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
Default region name [None]: us-east-1
Default output format [None]: json
```

**Verificar configuración**:
```bash
aws sts get-caller-identity
```

**Output esperado**:
```json
{
  "UserId": "AIDAJQABLZS4A3QDU576Q",
  "Account": "123456789012",
  "Arn": "arn:aws:iam::123456789012:user/tu-usuario"
}
```

### Configurar Región

**Recomendación**: `us-east-1` (N. Virginia)
- Menor latencia para LATAM
- Mayor disponibilidad de servicios
- Precios más bajos

```bash
# Verificar región actual
aws configure get region

# Cambiar región (si es necesario)
aws configure set region us-east-1
```

---

## Amazon DynamoDB

### Crear Tablas

#### Tabla: `Applications`

```bash
aws dynamodb create-table \
  --table-name Applications \
  --attribute-definitions \
    AttributeName=client_id,AttributeType=S \
    AttributeName=developer_id,AttributeType=S \
  --key-schema \
    AttributeName=client_id,KeyType=HASH \
    AttributeName=developer_id,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=TrueAuth Key=Environment,Value=Production
```

**Verificar creación**:
```bash
aws dynamodb describe-table --table-name Applications
```

#### Tabla: `AuditLogs`

```bash
aws dynamodb create-table \
  --table-name AuditLogs \
  --attribute-definitions \
    AttributeName=client_id,AttributeType=S \
    AttributeName=timestamp,AttributeType=S \
  --key-schema \
    AttributeName=client_id,KeyType=HASH \
    AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=TrueAuth Key=Environment,Value=Production
```

**Habilitar TTL** (eliminar logs > 90 días):
```bash
aws dynamodb update-time-to-live \
  --table-name AuditLogs \
  --time-to-live-specification "Enabled=true, AttributeName=ttl"
```

#### Tabla: `Sessions`

```bash
aws dynamodb create-table \
  --table-name Sessions \
  --attribute-definitions \
    AttributeName=session_id,AttributeType=S \
    AttributeName=client_id,AttributeType=S \
  --key-schema \
    AttributeName=session_id,KeyType=HASH \
    AttributeName=client_id,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=TrueAuth Key=Environment,Value=Production
```

**Crear GSI** (índice secundario por `client_id`):
```bash
aws dynamodb update-table \
  --table-name Sessions \
  --attribute-definitions \
    AttributeName=client_id,AttributeType=S \
    AttributeName=created_at,AttributeType=S \
  --global-secondary-index-updates \
    '[{
      "Create": {
        "IndexName": "client_id-index",
        "KeySchema": [
          {"AttributeName": "client_id", "KeyType": "HASH"},
          {"AttributeName": "created_at", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"},
        "ProvisionedThroughput": {
          "ReadCapacityUnits": 5,
          "WriteCapacityUnits": 5
        }
      }
    }]'
```

**Habilitar TTL**:
```bash
aws dynamodb update-time-to-live \
  --table-name Sessions \
  --time-to-live-specification "Enabled=true, AttributeName=ttl"
```

#### Tabla: `Developers`

```bash
aws dynamodb create-table \
  --table-name Developers \
  --attribute-definitions \
    AttributeName=email,AttributeType=S \
  --key-schema \
    AttributeName=email,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=TrueAuth Key=Environment,Value=Production
```

#### Tabla: `Connections` (WebSocket)

```bash
aws dynamodb create-table \
  --table-name Connections \
  --attribute-definitions \
    AttributeName=connectionId,AttributeType=S \
  --key-schema \
    AttributeName=connectionId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=TrueAuth Key=Environment,Value=Production
```

**Crear GSI** (índice secundario por `salaId`):
```bash
aws dynamodb update-table \
  --table-name Connections \
  --attribute-definitions \
    AttributeName=salaId,AttributeType=S \
    AttributeName=connectionId,AttributeType=S \
  --global-secondary-index-updates \
    '[{
      "Create": {
        "IndexName": "salaId-index",
        "KeySchema": [
          {"AttributeName": "salaId", "KeyType": "HASH"},
          {"AttributeName": "connectionId", "KeyType": "RANGE"}
        ],
        "Projection": {"ProjectionType": "ALL"},
        "ProvisionedThroughput": {
          "ReadCapacityUnits": 5,
          "WriteCapacityUnits": 5
        }
      }
    }]'
```

**Habilitar TTL**:
```bash
aws dynamodb update-time-to-live \
  --table-name Connections \
  --time-to-live-specification "Enabled=true, AttributeName=ttl"
```

#### Tabla: `Rooms` (WebSocket)

```bash
aws dynamodb create-table \
  --table-name Rooms \
  --attribute-definitions \
    AttributeName=salaId,AttributeType=S \
  --key-schema \
    AttributeName=salaId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --tags Key=Project,Value=TrueAuth Key=Environment,Value=Production
```

**Habilitar TTL**:
```bash
aws dynamodb update-time-to-live \
  --table-name Rooms \
  --time-to-live-specification "Enabled=true, AttributeName=ttl"
```

### Listar Todas las Tablas

```bash
aws dynamodb list-tables
```

**Output esperado**:
```json
{
  "TableNames": [
    "Applications",
    "AuditLogs",
    "Connections",
    "Developers",
    "Rooms",
    "Sessions"
  ]
}
```

### Insertar Datos de Prueba

```bash
# Insertar desarrollador de prueba
aws dynamodb put-item \
  --table-name Developers \
  --item '{
    "email": {"S": "test@trueauth.io"},
    "password_hash": {"S": "$2b$10$..."},
    "nombre": {"S": "Test User"},
    "created_at": {"S": "2026-07-10T00:00:00Z"}
  }'

# Insertar aplicación de prueba
aws dynamodb put-item \
  --table-name Applications \
  --item '{
    "client_id": {"S": "test-client-123"},
    "developer_id": {"S": "test@trueauth.io"},
    "nombre": {"S": "Test App"},
    "descripcion": {"S": "Aplicación de prueba"},
    "estado": {"S": "activa"},
    "created_at": {"S": "2026-07-10T00:00:00Z"},
    "updated_at": {"S": "2026-07-10T00:00:00Z"}
  }'
```

### Consultar Datos

```bash
# Obtener desarrollador por email
aws dynamodb get-item \
  --table-name Developers \
  --key '{"email": {"S": "test@trueauth.io"}}'

# Listar aplicaciones de un desarrollador
aws dynamodb query \
  --table-name Applications \
  --index-name developer_id-index \
  --key-condition-expression "developer_id = :devId" \
  --expression-attribute-values '{":devId": {"S": "test@trueauth.io"}}'
```

---

## AWS Lambda

### Crear Función Lambda

#### Lambda: `/api/verify`

**1. Crear archivo ZIP con código**:

```bash
# Crear directorio temporal
mkdir -p /tmp/lambda-verify
cd /tmp/lambda-verify

# Copiar código
cp /path/to/trueauth/src/aws/lambdas/verify.ts .
cp -r /path/to/trueauth/node_modules .

# Empaquetar
zip -r verify.zip verify.ts node_modules/
```

**2. Crear rol IAM para Lambda**:

```bash
# Crear rol
aws iam create-role \
  --role-name trueauth-lambda-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "lambda.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'

# Adjuntar política de CloudWatch Logs
aws iam attach-role-policy \
  --role-name trueauth-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Adjuntar política de DynamoDB
aws iam attach-role-policy \
  --role-name trueauth-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess
```

**3. Crear función Lambda**:

```bash
aws lambda create-function \
  --function-name trueauth-verify \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler verify.handler \
  --zip-file fileb://verify.zip \
  --timeout 10 \
  --memory-size 256 \
  --environment Variables={
    DYNAMODB_TABLE_AUDIT=AuditLogs,
    DYNAMODB_TABLE_SESSIONS=Sessions,
    JWT_PRIVATE_KEY_SSM=/trueauth/jwt/private-key
  } \
  --tags Project=TrueAuth,Environment=Production
```

**4. Verificar creación**:

```bash
aws lambda get-function --function-name trueauth-verify
```

#### Lambda: `/api/apps`

```bash
aws lambda create-function \
  --function-name trueauth-apps \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler apps.handler \
  --zip-file fileb://apps.zip \
  --timeout 5 \
  --memory-size 128 \
  --environment Variables={
    DYNAMODB_TABLE_APPS=Applications
  } \
  --tags Project=TrueAuth,Environment=Production
```

#### Lambda: `/api/metrics`

```bash
aws lambda create-function \
  --function-name trueauth-metrics \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler metrics.handler \
  --zip-file fileb://metrics.zip \
  --timeout 5 \
  --memory-size 128 \
  --environment Variables={
    DYNAMODB_TABLE_AUDIT=AuditLogs
  } \
  --tags Project=TrueAuth,Environment=Production
```

#### Lambda: `/api/sessions`

```bash
aws lambda create-function \
  --function-name trueauth-sessions \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler sessions.handler \
  --zip-file fileb://sessions.zip \
  --timeout 5 \
  --memory-size 128 \
  --environment Variables={
    DYNAMODB_TABLE_SESSIONS=Sessions
  } \
  --tags Project=TrueAuth,Environment=Production
```

#### Lambda: `/api/auth`

```bash
aws lambda create-function \
  --function-name trueauth-auth \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler auth.handler \
  --zip-file fileb://auth.zip \
  --timeout 5 \
  --memory-size 128 \
  --environment Variables={
    DYNAMODB_TABLE_DEVELOPERS=Developers
  } \
  --tags Project=TrueAuth,Environment=Production
```

#### Lambdas WebSocket

**Lambda: `$connect`**

```bash
aws lambda create-function \
  --function-name trueauth-ws-connect \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler connect.handler \
  --zip-file fileb://ws-connect.zip \
  --timeout 3 \
  --memory-size 128 \
  --environment Variables={
    DYNAMODB_TABLE_CONNECTIONS=Connections,
    DYNAMODB_TABLE_ROOMS=Rooms
  } \
  --tags Project=TrueAuth,Environment=Production
```

**Lambda: `$disconnect`**

```bash
aws lambda create-function \
  --function-name trueauth-ws-disconnect \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler disconnect.handler \
  --zip-file fileb://ws-disconnect.zip \
  --timeout 3 \
  --memory-size 128 \
  --environment Variables={
    DYNAMODB_TABLE_CONNECTIONS=Connections,
    DYNAMODB_TABLE_ROOMS=Rooms
  } \
  --tags Project=TrueAuth,Environment=Production
```

**Lambda: `sendMessage`**

```bash
aws lambda create-function \
  --function-name trueauth-ws-sendmessage \
  --runtime nodejs18.x \
  --role arn:aws:iam::123456789012:role/trueauth-lambda-role \
  --handler sendMessage.handler \
  --zip-file fileb://ws-sendmessage.zip \
  --timeout 5 \
  --memory-size 128 \
  --environment Variables={
    DYNAMODB_TABLE_CONNECTIONS=Connections,
    DYNAMODB_TABLE_ROOMS=Rooms
  } \
  --tags Project=TrueAuth,Environment=Production
```

### Actualizar Código de Lambda

```bash
# Empaquetar nuevo código
zip -r verify.zip verify.ts node_modules/

# Actualizar Lambda
aws lambda update-function-code \
  --function-name trueauth-verify \
  --zip-file fileb://verify.zip
```

### Invocar Lambda Manualmente

```bash
# Invocar con payload
aws lambda invoke \
  --function-name trueauth-verify \
  --payload '{"salaId":"test-123","paquete":{...}}' \
  --cli-binary-format raw-in-base64-out \
  response.json

# Ver respuesta
cat response.json
```

### Ver Logs de Lambda

```bash
# Ver logs en tiempo real
aws logs tail /aws/lambda/trueauth-verify --follow

# Ver logs de las últimas 10 minutos
aws logs tail /aws/lambda/trueauth-verify --since 10m
```

---

## API Gateway (HTTP)

### Crear API HTTP

```bash
aws apigatewayv2 create-api \
  --name trueauth-http-api \
  --protocol-type HTTP \
  --target arn:aws:lambda:us-east-1:123456789012:function:trueauth-verify \
  --tags Project=TrueAuth,Environment=Production
```

**Output**:
```json
{
  "ApiEndpoint": "https://abc123.execute-api.us-east-1.amazonaws.com",
  "ApiId": "abc123",
  "Name": "trueauth-http-api",
  "ProtocolType": "HTTP"
}
```

### Crear Rutas

**Ruta: POST `/api/verify`**

```bash
# Crear integración
aws apigatewayv2 create-integration \
  --api-id abc123 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-verify \
  --payload-format-version "2.0"

# Crear ruta
aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "POST /api/verify" \
  --target integrations/integration-id
```

**Ruta: GET `/api/apps`**

```bash
aws apigatewayv2 create-integration \
  --api-id abc123 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-apps \
  --payload-format-version "2.0"

aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "GET /api/apps" \
  --target integrations/integration-id
```

**Ruta: POST `/api/apps`**

```bash
aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "POST /api/apps" \
  --target integrations/integration-id
```

**Ruta: GET `/api/metrics`**

```bash
aws apigatewayv2 create-integration \
  --api-id abc123 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-metrics \
  --payload-format-version "2.0"

aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "GET /api/metrics" \
  --target integrations/integration-id
```

**Ruta: GET `/api/sessions`**

```bash
aws apigatewayv2 create-integration \
  --api-id abc123 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-sessions \
  --payload-format-version "2.0"

aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "GET /api/sessions" \
  --target integrations/integration-id
```

**Ruta: POST `/api/sessions/revoke`**

```bash
aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "POST /api/sessions/revoke" \
  --target integrations/integration-id
```

**Ruta: POST `/api/auth/register`**

```bash
aws apigatewayv2 create-integration \
  --api-id abc123 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-auth \
  --payload-format-version "2.0"

aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "POST /api/auth/register" \
  --target integrations/integration-id
```

**Ruta: POST `/api/auth/login`**

```bash
aws apigatewayv2 create-route \
  --api-id abc123 \
  --route-key "POST /api/auth/login" \
  --target integrations/integration-id
```

### Configurar CORS

```bash
aws apigatewayv2 update-api \
  --api-id abc123 \
  --cors-configuration '{
    "AllowOrigins": ["https://portal.trueauth.io", "http://localhost:5173"],
    "AllowHeaders": ["Content-Type", "Authorization"],
    "AllowMethods": ["GET", "POST", "OPTIONS"],
    "MaxAge": 3600
  }'
```

### Dar Permisos a API Gateway para Invocar Lambda

```bash
aws lambda add-permission \
  --function-name trueauth-verify \
  --statement-id apigateway-invoke \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:123456789012:abc123/*/*"
```

**Repetir para cada Lambda**.

### Crear Stage de Producción

```bash
aws apigatewayv2 create-stage \
  --api-id abc123 \
  --stage-name prod \
  --auto-deploy
```

### Probar API

```bash
# Health check
curl https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/health

# Verificar delegación
curl -X POST https://abc123.execute-api.us-east-1.amazonaws.com/prod/api/verify \
  -H "Content-Type: application/json" \
  -d '{"salaId":"test-123","paquete":{...}}'
```

---

## API Gateway (WebSocket)

### Crear API WebSocket

```bash
aws apigatewayv2 create-api \
  --name trueauth-ws-api \
  --protocol-type WEBSOCKET \
  --route-selection-expression '$request.body.action' \
  --tags Project=TrueAuth,Environment=Production
```

**Output**:
```json
{
  "ApiEndpoint": "wss://xyz789.execute-api.us-east-1.amazonaws.com",
  "ApiId": "xyz789",
  "Name": "trueauth-ws-api",
  "ProtocolType": "WEBSOCKET"
}
```

### Crear Rutas WebSocket

**Ruta: `$connect`**

```bash
# Crear integración
aws apigatewayv2 create-integration \
  --api-id xyz789 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-ws-connect \
  --payload-format-version "1.0"

# Crear ruta
aws apigatewayv2 create-route \
  --api-id xyz789 \
  --route-key '$connect' \
  --target integrations/integration-id
```

**Ruta: `$disconnect`**

```bash
aws apigatewayv2 create-integration \
  --api-id xyz789 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-ws-disconnect \
  --payload-format-version "1.0"

aws apigatewayv2 create-route \
  --api-id xyz789 \
  --route-key '$disconnect' \
  --target integrations/integration-id
```

**Ruta: `sendMessage`**

```bash
aws apigatewayv2 create-integration \
  --api-id xyz789 \
  --integration-type AWS_PROXY \
  --integration-uri arn:aws:lambda:us-east-1:123456789012:function:trueauth-ws-sendmessage \
  --payload-format-version "1.0"

aws apigatewayv2 create-route \
  --api-id xyz789 \
  --route-key 'sendMessage' \
  --target integrations/integration-id
```

### Dar Permisos a API Gateway para Invocar Lambdas WebSocket

```bash
# Lambda $connect
aws lambda add-permission \
  --function-name trueauth-ws-connect \
  --statement-id apigateway-ws-connect \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:123456789012:xyz789/*/$connect"

# Lambda $disconnect
aws lambda add-permission \
  --function-name trueauth-ws-disconnect \
  --statement-id apigateway-ws-disconnect \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:123456789012:xyz789/*/$disconnect"

# Lambda sendMessage
aws lambda add-permission \
  --function-name trueauth-ws-sendmessage \
  --statement-id apigateway-ws-sendmessage \
  --action lambda:InvokeFunction \
  --principal apigateway.amazonaws.com \
  --source-arn "arn:aws:execute-api:us-east-1:123456789012:xyz789/*/sendMessage"
```

### Dar Permisos a Lambda para Enviar Mensajes WebSocket

**Crear política IAM personalizada**:

```bash
aws iam create-policy \
  --policy-name trueauth-ws-send-message \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": "execute-api:ManageConnections",
        "Resource": "arn:aws:execute-api:us-east-1:123456789012:xyz789/*"
      }
    ]
  }'

# Adjuntar política al rol de Lambda
aws iam attach-role-policy \
  --role-name trueauth-lambda-role \
  --policy-arn arn:aws:iam::123456789012:policy/trueauth-ws-send-message
```

### Crear Stage de Producción

```bash
aws apigatewayv2 create-stage \
  --api-id xyz789 \
  --stage-name prod \
  --auto-deploy
```

### Probar WebSocket

```bash
# Instalar wscat
npm install -g wscat

# Conectar
wscat -c "wss://xyz789.execute-api.us-east-1.amazonaws.com/prod"

# Esperar mensaje de conexión
# {"salaId":"abc-123","connectionId":"xyz-456"}

# Enviar mensaje
> {"action":"sendMessage","salaId":"abc-123","paquete":{...}}
```

---

## IAM Roles y Permisos

### Rol para Lambdas

**Crear rol**:
```bash
aws iam create-role \
  --role-name trueauth-lambda-role \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "Service": "lambda.amazonaws.com"
        },
        "Action": "sts:AssumeRole"
      }
    ]
  }'
```

**Adjuntar políticas**:

```bash
# CloudWatch Logs (para logging)
aws iam attach-role-policy \
  --role-name trueauth-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# DynamoDB (acceso completo)
aws iam attach-role-policy \
  --role-name trueauth-lambda-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess

# API Gateway WebSocket (enviar mensajes)
aws iam attach-role-policy \
  --role-name trueauth-lambda-role \
  --policy-arn arn:aws:iam::123456789012:policy/trueauth-ws-send-message
```

### Política de Mínimos Privilegios (Recomendado)

**En lugar de `AmazonDynamoDBFullAccess`, crear política personalizada**:

```bash
aws iam create-policy \
  --policy-name trueauth-dynamodb-access \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ],
        "Resource": [
          "arn:aws:dynamodb:us-east-1:123456789012:table/Applications",
          "arn:aws:dynamodb:us-east-1:123456789012:table/AuditLogs",
          "arn:aws:dynamodb:us-east-1:123456789012:table/Sessions",
          "arn:aws:dynamodb:us-east-1:123456789012:table/Developers",
          "arn:aws:dynamodb:us-east-1:123456789012:table/Connections",
          "arn:aws:dynamodb:us-east-1:123456789012:table/Rooms",
          "arn:aws:dynamodb:us-east-1:123456789012:table/*/index/*"
        ]
      }
    ]
  }'
```

---

## Monitoreo y Alertas

### Configurar CloudWatch Alarms

**Alarma: Lambda Errors**

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "trueauth-lambda-errors" \
  --alarm-description "Alerta si hay más de 10 errores en Lambdas" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 10 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:trueauth-alerts
```

**Alarma: DynamoDB Throttling**

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name "trueauth-dynamodb-throttling" \
  --alarm-description "Alerta si hay throttling en DynamoDB" \
  --metric-name ThrottledRequests \
  --namespace AWS/DynamoDB \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:trueauth-alerts
```

### Configurar Budget Alert

**Crear presupuesto con alerta**:

1. Ir a [AWS Billing Dashboard](https://console.aws.amazon.com/billing/)
2. Click en "Budgets" → "Create budget"
3. Seleccionar "Monthly cost budget"
4. Nombre: "TrueAuth Monthly Budget"
5. Budget amount: $5 (alerta si supera $5/mes)
6. Alert threshold: 80% (alerta al llegar a $4)
7. Email: tu-email@ejemplo.com

---

## Optimización de Costos

### 1. Usar Modo On-Demand en DynamoDB

**Ventaja**: Solo pagas por lo que usas (ideal para tráfico variable).

```bash
# Verificar modo de billing
aws dynamodb describe-table --table-name Applications | grep BillingModeSummary
```

### 2. Habilitar TTL en Tablas

**Ventaja**: Elimina items expirados automáticamente (sin costo de escritura).

```bash
# Verificar TTL
aws dynamodb describe-time-to-live --table-name Sessions
```

### 3. Optimizar Tamaño de Lambdas

**Recomendación**:
- Lambdas simples (CRUD): 128 MB
- Lambdas complejas (criptografía): 256 MB

**Verificar configuración**:
```bash
aws lambda get-function-configuration --function-name trueauth-verify
```

### 4. Usar Lambda Layers para Dependencias Comunes

**Ventaja**: Reduce tamaño de paquetes ZIP, acelera deploys.

```bash
# Crear layer con node_modules
zip -r dependencies.zip node_modules/

aws lambda publish-layer-version \
  --layer-name trueauth-dependencies \
  --zip-file fileb://dependencies.zip \
  --compatible-runtimes nodejs18.x

# Asociar layer a Lambda
aws lambda update-function-configuration \
  --function-name trueauth-verify \
  --layers arn:aws:lambda:us-east-1:123456789012:layer:trueauth-dependencies:1
```

### 5. Monitorear Uso del Free Tier

**Ver uso mensual**:

1. Ir a [AWS Free Tier Dashboard](https://console.aws.amazon.com/billing/home#/freetier)
2. Revisar uso por servicio
3. Configurar alertas si te acercas al límite

---

## Checklist de Configuración

### Semana 1: Backend Serverless

- [ ] Cuenta AWS creada
- [ ] AWS CLI instalado y configurado
- [ ] Tablas DynamoDB creadas (6 tablas)
- [ ] TTL habilitado en tablas con expiración
- [ ] Lambdas creadas (8 funciones)
- [ ] API Gateway HTTP configurado
- [ ] API Gateway WebSocket configurado
- [ ] CORS configurado correctamente
- [ ] IAM roles con permisos mínimos
- [ ] CloudWatch alarms configurados
- [ ] Budget alert configurado ($5/mes)
- [ ] Tests manuales pasan (curl + wscat)

### Verificación Final

```bash
# Listar todas las tablas DynamoDB
aws dynamodb list-tables

# Listar todas las Lambdas
aws lambda list-functions --query 'Functions[].FunctionName'

# Listar APIs de API Gateway
aws apigatewayv2 get-apis --query 'Items[].Name'

# Verificar costos (debería ser $0)
aws ce get-cost-and-usage \
  --time-period Start=2026-07-01,End=2026-07-31 \
  --granularity MONTHLY \
  --metrics "BlendedCost"
```

---

## Recursos Adicionales

### Documentación Oficial

- [AWS Free Tier](https://aws.amazon.com/free/)
- [AWS Lambda Developer Guide](https://docs.aws.amazon.com/lambda/)
- [Amazon DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/)
- [API Gateway Developer Guide](https://docs.aws.amazon.com/apigateway/)

### Herramientas Útiles

- **AWS Console**: Interfaz web para gestionar servicios
- **AWS CloudFormation**: Infraestructura como código (opcional)
- **AWS SAM**: Serverless Application Model (opcional)
- **Serverless Framework**: Framework para deploy serverless (opcional)

### Calculadoras de Costos

- [AWS Pricing Calculator](https://calculator.aws/)
- [DynamoDB Calculator](https://aws.amazon.com/dynamodb/pricing/)
- [Lambda Calculator](https://aws.amazon.com/lambda/pricing/)

---

**Documento mantenido por:** TrueAuth Core Team  
**Última actualización:** Julio 2026
