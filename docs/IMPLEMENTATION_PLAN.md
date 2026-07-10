# TrueAuth - Plan de Implementación (3 Semanas)

**Sprint:** Julio 2026 (Vacaciones de Facultad)  
**Duración:** 3 semanas (15 días hábiles)  
**Objetivo:** Migrar de monolito a AWS Serverless y lanzar MVP v3.0

---

## Resumen Ejecutivo

Este documento detalla el plan de implementación para transformar TrueAuth de su arquitectura monolítica actual (Fastify + SQLite) a una arquitectura serverless en AWS (Lambda + DynamoDB + API Gateway), manteniendo el costo en **$0** aprovechando el Free Tier de AWS.

### Objetivos del Sprint

1. **Backend Serverless**: Migrar toda la lógica del servidor a AWS Lambda + API Gateway
2. **Multi-tenancy**: Implementar aislamiento de datos por `client_id` en DynamoDB
3. **Portal SaaS**: Crear dashboard para desarrolladores con métricas en tiempo real
4. **SDK Brandado**: Empaquetar `trueauth-sdk.js` listo para producción
5. **Deploy Cloud**: Desplegar frontends en Vercel + backend en AWS
6. **Demo en Vivo**: Crear e-commerce ficticio para demostrar el flujo completo

---

## SEMANA 1: Backend Serverless (AWS Cloud Multi-Tenant)

**Objetivo**: Migrar el monolito a AWS para infraestructura escalable costo $0.

### Día 1-2: Setup AWS y API Gateway WebSockets

#### Entregable 1.1: AWS API Gateway (WebSockets)

**Configuración del puente en tiempo real para emparejar Notebook y Celular mediante salas efímeras (connectionId).**

**Tareas**:
- [ ] Crear cuenta AWS y configurar CLI (`aws configure`)
- [ ] Crear API Gateway WebSocket (`trueauth-ws-api`)
- [ ] Definir rutas: `$connect`, `$disconnect`, `sendMessage`
- [ ] Configurar tabla DynamoDB `Connections` para mapear `connectionId` ↔ `salaId`
- [ ] Implementar Lambda `$connect`:
  - Generar `salaId` (UUID v4)
  - Registrar `connectionId` + `salaId` + `role=notebook` en DynamoDB
  - Retornar `salaId` al cliente
- [ ] Implementar Lambda `$disconnect`:
  - Eliminar `connectionId` de DynamoDB
  - Si la sala queda vacía, eliminar sala
- [ ] Implementar Lambda `sendMessage`:
  - Parsear mensaje (`delegacion_enviar`)
  - Buscar `connectionId` de la notebook en la misma sala
  - Usar `@aws-sdk/client-apigatewaymanagementapi` para enviar mensaje a notebook
  - Retornar ACK al celular
- [ ] Probar conexión WebSocket con `wscat`
- [ ] Documentar endpoints en `docs/AWS_SETUP.md`

**Criterios de Aceptación**:
- ✅ Notebook se conecta y recibe `salaId` por WebSocket
- ✅ Celular se conecta y puede enviar mensaje a sala específica
- ✅ Servidor retransmite mensaje del celular a la notebook
- ✅ Desconexión limpia recursos en DynamoDB

**Archivos a Crear**:
```
src/aws/
├── websocket/
│   ├── connect.ts          # Lambda $connect
│   ├── disconnect.ts       # Lambda $disconnect
│   └── sendMessage.ts      # Lambda sendMessage
└── shared/
    └── dynamodb.ts         # Cliente DynamoDB + helpers
```

---

### Día 3-4: Lambdas de Verificación Criptográfica

#### Entregable 1.2: AWS Lambdas (TypeScript)

**Funciones Serverless para manejar conexiones y la Lambda crítica `/api/verify` (conversión de firmas Raw a DER y validación criptográfica ECDSA P-256).**

**Tareas**:
- [ ] Crear Lambda `/api/verify`:
  - Migrar lógica de `crypto-verifier.ts` a Lambda
  - Implementar conversión `rawSignatureToDER()` (CRÍTICO)
  - Implementar `jwkToPEM()` para importar clave pública
  - Verificar firma ECDSA-SHA256 con `node:crypto`
  - Validar expiración del payload
  - Generar JWT firmado (ES256)
  - Registrar auditoría en DynamoDB `AuditLogs`
  - Retornar `{ valido, sessionToken, expira_en }`
- [ ] Crear Lambda `/api/apps`:
  - POST: Crear nueva app (genera `client_id` UUID)
  - GET: Listar apps por `developer_id`
  - Validar JWT de desarrollador autenticado
- [ ] Crear Lambda `/api/metrics`:
  - GET: Consultar `AuditLogs` por `client_id` + rango de fechas
  - Retornar métricas agregadas (logins exitosos, fallidos, sesiones activas)
- [ ] Crear Lambda `/api/sessions`:
  - GET: Listar sesiones activas por `client_id`
  - POST `/revoke`: Revocar sesión por `session_id`
- [ ] Crear Lambda `/api/auth`:
  - POST `/register`: Registrar desarrollador (email + password)
  - POST `/login`: Autenticar desarrollador (retorna JWT)
  - POST `/login-trueauth`: Login con TrueAuth (dogfooding)
- [ ] Configurar API Gateway HTTP para las Lambdas
- [ ] Probar cada Lambda con `aws lambda invoke`
- [ ] Escribir tests unitarios para conversión raw→DER

**Criterios de Aceptación**:
- ✅ Lambda `/api/verify` verifica firma ECDSA correctamente
- ✅ Conversión raw→DER funciona (test unitario pasa)
- ✅ JWT generado es válido y verificable
- ✅ Auditoría se registra en DynamoDB
- ✅ Todas las Lambdas responden en < 500ms

**Archivos a Crear**:
```
src/aws/
├── lambdas/
│   ├── verify.ts           # Lambda /api/verify (CRÍTICA)
│   ├── apps.ts             # Lambda /api/apps
│   ├── metrics.ts          # Lambda /api/metrics
│   ├── sessions.ts         # Lambda /api/sessions
│   └── auth.ts             # Lambda /api/auth
└── shared/
    ├── crypto.ts           # Lógica criptográfica (raw→DER, jwkToPEM)
    ├── jwt.ts              # Generación/verificación JWT
    └── types.ts            # Tipos compartidos
```

---

### Día 5: DynamoDB Multi-Tenant

#### Entregable 1.3: Amazon DynamoDB

**Tabla 'Applications' (validación de client_id activos de empresas) y Tabla 'AuditLogs' (registro histórico y métricas).**

**Tareas**:
- [ ] Diseñar esquema de tablas DynamoDB:
  - `Applications`: PK=`client_id`, SK=`developer_id`
  - `AuditLogs`: PK=`client_id`, SK=`timestamp`
  - `Sessions`: PK=`session_id`, SK=`client_id`
  - `Developers`: PK=`email`, SK=`email`
  - `Connections`: PK=`connectionId`, SK=`salaId` (GSI)
- [ ] Crear tablas con AWS CLI o CloudFormation
- [ ] Implementar helpers de DynamoDB:
  - `putItem()`, `getItem()`, `query()`, `deleteItem()`
  - Manejo de condicionales (ej: `client_id` único)
- [ ] Implementar TTL (Time-To-Live) para sesiones expiradas
- [ ] Configurar índices secundarios (GSI):
  - `AuditLogs`: GSI por `session_id`
  - `Sessions`: GSI por `sala_id`
- [ ] Migrar datos de SQLite a DynamoDB (script de migración)
- [ ] Probar queries con `aws dynamodb query`
- [ ] Documentar esquema en `docs/DATABASE_SCHEMA.md`

**Criterios de Aceptación**:
- ✅ Todas las tablas creadas en DynamoDB
- ✅ Queries funcionan correctamente
- ✅ TTL elimina sesiones expiradas automáticamente
- ✅ Índices secundarios permiten consultas eficientes
- ✅ Costo estimado < $0.50/mes (Free Tier)

**Archivos a Crear**:
```
src/aws/
├── dynamodb/
│   ├── schema.ts           # Definición de tablas
│   ├── migrations.ts       # Script de migración SQLite → DynamoDB
│   └── helpers.ts          # Funciones helper para queries
└── cloudformation/
    └── dynamodb.yaml       # Template CloudFormation (opcional)
```

---

### Semana 1: Checklist de Cierre

- [ ] Todas las Lambdas desplegadas y funcionales
- [ ] API Gateway WebSocket probado con frontends actuales
- [ ] API Gateway HTTP probado con `curl`
- [ ] DynamoDB tablas creadas y pobladas con datos de prueba
- [ ] Tests unitarios para conversión raw→DER pasan
- [ ] Documentación de endpoints actualizada
- [ ] Costo AWS verificado (< $1 en Free Tier)

---

## SEMANA 2: SDK Brandado y Dashboard SaaS

**Objetivo**: Crear el portal de clientes y empaquetar el Widget de integración.

### Día 6-7: Portal del Desarrollador (SaaS Frontend)

#### Entregable 2.1: Portal del Desarrollador (SaaS Frontend)

**SPA moderna de registro y administración. El acceso requiere loguearse con TrueAuth usando su propio QR (Dogfooding).**

**Tareas**:
- [ ] Setup proyecto Vite + TypeScript + React (o Vue/Svelte)
- [ ] Configurar TailwindCSS (o similar) para estilos
- [ ] Crear layout principal:
  - Sidebar con navegación (Dashboard, Apps, Métricas, Docs)
  - Header con perfil de usuario + logout
- [ ] Implementar vista `/login`:
  - Formulario tradicional (email + password)
  - Botón "Login con TrueAuth" (integra SDK)
  - QR para escanear con celular
- [ ] Implementar vista `/register`:
  - Formulario de registro (nombre, email, password)
  - Validación de campos
  - Confirmación por email (opcional, puede ser mock)
- [ ] Implementar vista `/dashboard`:
  - Cards con métricas clave (logins hoy, sesiones activas, tasa de éxito)
  - Gráfico de actividad últimos 7 días
  - Lista de apps recientes
- [ ] Implementar vista `/apps`:
  - Tabla con todas las apps del desarrollador
  - Botón "Crear Nueva App" (modal)
  - Acciones: copiar `client_id`, editar, desactivar
- [ ] Implementar vista `/metrics`:
  - Selector de app + rango de fechas
  - Gráficos: logins por día, sesiones activas, tasa de éxito
  - Exportar CSV
- [ ] Implementar vista `/docs`:
  - Guía de integración del SDK
  - Snippet de código copiable
  - Ejemplos en diferentes frameworks
- [ ] Configurar router (React Router o similar)
- [ ] Implementar autenticación:
  - Guardar JWT en localStorage
  - Interceptor para agregar `Authorization: Bearer <token>` en requests
  - Redirect a `/login` si token expirado
- [ ] Conectar con Lambdas de AWS (fetch a API Gateway HTTP)

**Criterios de Aceptación**:
- ✅ Desarrollador puede registrarse y hacer login
- ✅ Login con TrueAuth funciona (dogfooding)
- ✅ Dashboard muestra métricas reales de DynamoDB
- ✅ CRUD de apps funcional
- ✅ Métricas se actualizan en tiempo real
- ✅ UI responsive (mobile-friendly)

**Archivos a Crear**:
```
src/portal/
├── index.html
├── main.tsx
├── App.tsx
├── components/
│   ├── Layout.tsx
│   ├── Sidebar.tsx
│   ├── Header.tsx
│   └── ProtectedRoute.tsx
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
│   └── api.ts              # Cliente HTTP para Lambdas
└── styles/
    └── globals.css
```

---

### Día 8-9: Panel de Métricas

#### Entregable 2.2: Panel de Métricas

**Sección donde el cliente genera su client_id y visualiza gráficos de logins exitosos consumiendo la Lambda de auditoría.**

**Tareas**:
- [ ] Instalar librería de gráficos (Chart.js o Recharts)
- [ ] Crear componente `<MetricsChart>`:
  - Props: `data`, `type` (line, bar, pie), `title`
  - Responsive y animado
- [ ] Implementar gráfico "Logins por Día":
  - Eje X: fechas (últimos 30 días)
  - Eje Y: cantidad de logins
  - Línea verde (exitosos) + línea roja (fallidos)
- [ ] Implementar gráfico "Sesiones Activas":
  - Gráfico de barras por app
  - Colores por estado (activa, revocada, expirada)
- [ ] Implementar gráfico "Tasa de Éxito":
  - Gráfico circular (pie chart)
  - Porcentaje de logins exitosos vs fallidos
- [ ] Crear componente `<MetricsCard>`:
  - Props: `title`, `value`, `trend` (up/down), `icon`
  - Ejemplo: "Logins Hoy: 1,234 (+12%)"
- [ ] Implementar selector de rango de fechas:
  - Botones: "Hoy", "7 días", "30 días", "Personalizado"
  - Date picker para rango personalizado
- [ ] Implementar selector de app:
  - Dropdown con todas las apps del desarrollador
  - Opción "Todas las apps"
- [ ] Implementar exportación CSV:
  - Botón "Exportar CSV"
  - Generar CSV con datos filtrados
  - Descargar automáticamente
- [ ] Conectar con Lambda `/api/metrics`:
  - Fetch datos al cambiar filtros
  - Loading state mientras carga
  - Error handling si falla
- [ ] Optimizar rendimiento:
  - Memoizar gráficos con `useMemo`
  - Debounce en cambios de filtro
  - Lazy loading de componentes pesados

**Criterios de Aceptación**:
- ✅ Gráficos renderizan datos reales de DynamoDB
- ✅ Filtros (fecha, app) actualizan gráficos en tiempo real
- ✅ Exportación CSV funciona correctamente
- ✅ Gráficos son responsive y accesibles
- ✅ Performance: < 1s en renderizar gráficos

**Archivos a Crear**:
```
src/portal/
├── components/
│   ├── metrics/
│   │   ├── MetricsChart.tsx
│   │   ├── MetricsCard.tsx
│   │   ├── DateRangeSelector.tsx
│   │   └── AppSelector.tsx
│   └── ui/
│       ├── Button.tsx
│       ├── Card.tsx
│       └── Dropdown.tsx
└── utils/
    └── csv.ts              # Helper para exportar CSV
```

---

### Día 10: SDK trueauth-sdk.js

#### Entregable 2.3: SDK trueauth-sdk.js

**Script optimizado que inyecta el botón oficial ("Verificar con TrueAuth"), maneja loaders, capturas de error y limpia el DOM al terminar.**

**Tareas**:
- [ ] Renombrar `keypass-sdk.ts` → `trueauth-sdk.ts`
- [ ] Actualizar branding:
  - Nombre: "TrueAuth" (no "KeyPass")
  - Botón: "Verificar con TrueAuth"
  - Colores: definir paleta oficial (azul/verde)
  - Logo: crear SVG simple (escudo + checkmark)
- [ ] Refactorizar API pública:
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
  
  window.TrueAuth.init(config);
  ```
- [ ] Implementar botón oficial:
  - Renderiza botón con logo + texto "Verificar con TrueAuth"
  - Al hacer click, muestra QR en modal
  - Loader mientras genera claves
- [ ] Implementar modal de QR:
  - Overlay oscuro
  - QR centrado con instrucciones
  - Botón "Cancelar" para cerrar
  - Auto-cierre al completar autenticación
- [ ] Implementar estados de UI:
  - `idle`: Botón visible
  - `loading`: Spinner mientras conecta WebSocket
  - `qr`: Modal con QR visible
  - `success`: Mensaje de éxito + callback
  - `error`: Mensaje de error + botón reintentar
- [ ] Implementar limpieza de DOM:
  - Al completar (éxito o error), remover modal
  - Resetear estado a `idle`
  - Cerrar WebSocket
- [ ] Implementar manejo de errores:
  - Error de conexión WebSocket
  - Error de verificación (firma inválida)
  - Timeout (30 segundos sin respuesta)
  - Usuario cancela
- [ ] Optimizar bundle:
  - Configurar Vite para tree-shaking
  - Minificar con Terser
  - Analizar tamaño con `rollup-plugin-visualizer`
  - Objetivo: < 50KB gzipped
- [ ] Generar build de producción:
  - `trueauth-sdk.min.js` (UMD para `<script>` tag)
  - `trueauth-sdk.esm.js` (ES Module para npm)
- [ ] Crear CDN (opcional):
  - Subir a GitHub Releases
  - O usar jsDelivr/unpkg
- [ ] Actualizar documentación del SDK:
  - README con ejemplos
  - API reference
  - Troubleshooting

**Criterios de Aceptación**:
- ✅ SDK se carga con `<script>` tag
- ✅ Botón "Verificar con TrueAuth" se renderiza
- ✅ Flujo completo funciona (QR → scan → verify → token)
- ✅ Errores se manejan gracefully
- ✅ DOM se limpia al terminar
- ✅ Bundle < 50KB gzipped
- ✅ Documentación completa

**Archivos a Modificar**:
```
src/sdk/
├── trueauth-sdk.ts         # Renombrado de keypass-sdk.ts
├── example.html            # Actualizado con nuevo branding
└── README.md               # Actualizado
```

---

### Semana 2: Checklist de Cierre

- [ ] Portal del Desarrollador desplegado localmente
- [ ] Login tradicional y con TrueAuth funcionan
- [ ] CRUD de apps funcional
- [ ] Métricas se visualizan correctamente
- [ ] SDK renombrado a `trueauth-sdk.js`
- [ ] SDK build de producción generado
- [ ] Documentación del SDK actualizada
- [ ] Tests manuales del portal completados

---

## SEMANA 3: Despliegue, Mobile Web y Demo en Vivo

**Objetivo**: Refinar la experiencia de usuario y lanzar el entorno de prueba cloud.

### Día 11-12: Optimización Mobile (/mobile)

#### Entregable 3.1: Optimización Mobile (/mobile)

**Interfaz web-mobile que permite al usuario visualizar y gestionar el historial de notebooks que tiene actualmente autorizadas.**

**Tareas**:
- [ ] Rediseñar UI mobile-first:
  - Layout vertical (max-width 420px)
  - Touch-friendly (botones grandes, spacing adecuado)
  - Animaciones suaves (transitions CSS)
- [ ] Implementar vista principal `/mobile`:
  - Header con logo TrueAuth
  - Botón "Escanear QR" (abre cámara)
  - Lista de "Dispositivos Autorizados"
- [ ] Implementar scanner QR:
  - Usar `html5-qrcode` (ya integrado)
  - Fullscreen en mobile
  - Instrucciones claras ("Apunta al QR de tu notebook")
- [ ] Implementar lista de dispositivos autorizados:
  - Card por cada dispositivo:
    - Nombre del dispositivo (ej: "MacBook Pro de Julián")
    - Fecha de autorización
    - Fecha de expiración
    - Botón "Revocar"
  - Empty state: "No tienes dispositivos autorizados"
- [ ] Implementar revocación de dispositivos:
  - Confirmación antes de revocar ("¿Estás seguro?")
  - POST a Lambda `/api/sessions/revoke`
  - Actualizar lista automáticamente
- [ ] Implementar historial de actividad:
  - Lista de últimos 10 logins
  - Cada item: dispositivo, fecha, IP (opcional)
- [ ] Implementar perfil de usuario:
  - Avatar (iniciales o imagen)
  - Nombre/email
  - Botón "Cerrar sesión"
- [ ] Implementar notificaciones (opcional):
  - Toast al autorizar dispositivo
  - Toast al revocar dispositivo
  - Toast en caso de error
- [ ] Optimizar performance:
  - Lazy loading de imágenes
  - Virtual scrolling para listas largas
  - Service Worker para offline (opcional)
- [ ] Testing en dispositivos reales:
  - iPhone (Safari)
  - Android (Chrome)
  - Tablets (iPad, Samsung Tab)

**Criterios de Aceptación**:
- ✅ UI es responsive y touch-friendly
- ✅ Scanner QR funciona en mobile
- ✅ Lista de dispositivos se carga desde DynamoDB
- ✅ Revocación funciona correctamente
- ✅ Performance: < 2s en cargar en 4G
- ✅ Compatible con iOS Safari y Android Chrome

**Archivos a Modificar**:
```
src/frontend/mobile/
├── index.html              # Actualizado con nuevas vistas
├── main.ts                 # Refactorizado con router
└── styles.css              # Mejorado mobile-first
```

**Archivos a Crear**:
```
src/frontend/mobile/
├── components/
│   ├── DeviceCard.ts
│   ├── QRScanner.ts
│   └── ActivityLog.ts
└── views/
    ├── Home.ts
    ├── Scanner.ts
    └── Profile.ts
```

---

### Día 13-14: Producción Cloud

#### Entregable 3.2: Producción Cloud

**Deploy de frontends en Vercel apuntando a endpoints reales de AWS (HTTPS/WSS).**

**Tareas**:
- [ ] Configurar Vercel:
  - Crear cuenta (si no existe)
  - Instalar Vercel CLI (`npm i -g vercel`)
  - Login (`vercel login`)
- [ ] Preparar frontends para deploy:
  - Crear `vercel.json` para cada frontend
  - Configurar variables de entorno (API URLs)
  - Optimizar builds (tree-shaking, minificación)
- [ ] Deploy Portal del Desarrollador:
  - `vercel --prod` desde `src/portal/`
  - Configurar dominio personalizado (opcional: `portal.trueauth.io`)
  - Configurar CORS en API Gateway para permitir dominio
- [ ] Deploy Frontend Notebook:
  - `vercel --prod` desde `src/frontend/notebook/`
  - Configurar dominio (opcional: `app.trueauth.io`)
- [ ] Deploy Frontend Mobile:
  - `vercel --prod` desde `src/frontend/mobile/`
  - Configurar dominio (opcional: `m.trueauth.io`)
- [ ] Configurar AWS API Gateway:
  - Habilitar CORS para dominios de Vercel
  - Configurar custom domain (opcional: `api.trueauth.io`)
  - Generar API key (opcional, para rate limiting)
- [ ] Configurar HTTPS:
  - Vercel provee HTTPS automático (Let's Encrypt)
  - API Gateway provee HTTPS automático
  - WebSocket usa WSS automático
- [ ] Configurar variables de entorno en Vercel:
  - `VITE_API_URL`: URL del API Gateway HTTP
  - `VITE_WS_URL`: URL del API Gateway WebSocket
- [ ] Testing end-to-end en producción:
  - Flujo completo: Portal → Crear App → SDK → Login
  - Verificar que todo funciona con URLs reales
  - Verificar que no hay mixed content (HTTP en HTTPS)
- [ ] Configurar monitoreo (opcional):
  - AWS CloudWatch para Lambdas
  - Vercel Analytics para frontends
  - Sentry para error tracking (opcional)

**Criterios de Aceptación**:
- ✅ Todos los frontends desplegados en Vercel
- ✅ Frontends apuntan a AWS API Gateway (HTTPS/WSS)
- ✅ Flujo completo funciona en producción
- ✅ No hay errores de CORS
- ✅ Performance: Lighthouse score > 90
- ✅ Costo: $0 (Vercel Hobby + AWS Free Tier)

**Archivos a Crear**:
```
vercel.json                 # Configuración global de Vercel
src/portal/vercel.json      # Configuración específica del portal
src/frontend/notebook/vercel.json
src/frontend/mobile/vercel.json
```

---

### Día 15: Entorno Demo

#### Entregable 3.3: Entorno Demo

**Creación de una web e-commerce ficticia conectada al SDK para probar el flujo de TrueAuth en vivo desde cualquier lugar del mundo.**

**Tareas**:
- [ ] Crear proyecto Vite + TypeScript para e-commerce ficticio:
  - Nombre: "TechStore Demo"
  - Diseño moderno (TailwindCSS)
- [ ] Implementar páginas del e-commerce:
  - `/`: Home con productos destacados
  - `/products`: Catálogo de productos
  - `/product/:id`: Detalle de producto
  - `/cart`: Carrito de compras
  - `/checkout`: Checkout (aquí se integra TrueAuth)
- [ ] Implementar carrito de compras:
  - Agregar/quitar productos
  - Calcular total
  - Persistir en localStorage
- [ ] Integrar TrueAuth en `/checkout`:
  - Botón "Verificar con TrueAuth" (SDK)
  - Al autenticarse, mostrar "Identidad verificada ✓"
  - Habilitar botón "Confirmar Compra"
  - Al confirmar, mostrar "¡Compra exitosa!"
- [ ] Crear productos ficticios:
  - 10-15 productos (laptops, celulares, auriculares)
  - Imágenes de Unsplash o placeholders
  - Precios en USD
- [ ] Implementar flujo completo:
  1. Usuario navega productos
  2. Agrega al carrito
  3. Va a checkout
  4. Hace click en "Verificar con TrueAuth"
  5. Escanea QR con celular
  6. Identidad verificada
  7. Confirma compra
  8. Orden confirmada
- [ ] Deploy en Vercel:
  - `vercel --prod` desde `demo/`
  - Dominio: `demo.trueauth.io` (opcional)
- [ ] Crear video demo (opcional):
  - Grabar pantalla + celular
  - Mostrar flujo completo
  - Subir a YouTube/Loom
- [ ] Escribir blog post (opcional):
  - "Cómo integrar TrueAuth en tu e-commerce"
  - Screenshots del flujo
  - Snippet de código
- [ ] Preparar presentación:
  - Slides con arquitectura
  - Demo en vivo
  - Q&A

**Criterios de Aceptación**:
- ✅ E-commerce ficticio es funcional
- ✅ TrueAuth SDK está integrado en checkout
- ✅ Flujo completo funciona desde cualquier lugar
- ✅ Deploy en Vercel exitoso
- ✅ Demo es presentable a inversores/clientes

**Archivos a Crear**:
```
demo/
├── index.html
├── main.ts
├── App.ts
├── pages/
│   ├── Home.ts
│   ├── Products.ts
│   ├── ProductDetail.ts
│   ├── Cart.ts
│   └── Checkout.ts
├── components/
│   ├── ProductCard.ts
│   ├── CartItem.ts
│   └── TrueAuthButton.ts
├── data/
│   └── products.ts         # Productos ficticios
└── styles/
    └── globals.css
```

---

### Semana 3: Checklist de Cierre

- [ ] Frontend mobile optimizado y funcional
- [ ] Todos los frontends desplegados en Vercel
- [ ] AWS API Gateway configurado con CORS
- [ ] Flujo completo funciona en producción
- [ ] E-commerce demo desplegado
- [ ] Video demo grabado (opcional)
- [ ] Presentación preparada
- [ ] Documentación final actualizada

---

## Hitos y Fechas Clave

| Hito | Fecha | Entregables |
|------|-------|-------------|
| **Fin Semana 1** | Día 5 | Backend serverless completo (API Gateway + Lambdas + DynamoDB) |
| **Fin Semana 2** | Día 10 | Portal SaaS + SDK brandado + Métricas |
| **Fin Semana 3** | Día 15 | Deploy cloud + Mobile optimizado + Demo e-commerce |

---

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| **AWS Free Tier excedido** | Baja | Medio | Monitorear uso diario, configurar alertas de billing |
| **WebSocket latency alta** | Media | Alto | Usar regiones AWS cercanas (us-east-1 para LATAM) |
| **CORS errors en producción** | Alta | Medio | Configurar CORS correctamente en API Gateway |
| **Bundle SDK muy grande** | Media | Medio | Tree-shaking, minificación, analizar con visualizer |
| **Mobile Safari bugs** | Alta | Alto | Testing temprano en iOS, polyfills si necesario |
| **DynamoDB hot partitions** | Baja | Alto | Diseñar claves de partición distribuidas |
| **JWT keys comprometidas** | Baja | Crítico | Rotación de claves, almacenar en AWS Secrets Manager |

---

## Recursos Necesarios

### Cuentas y Servicios

- **AWS Account**: Free Tier (Lambda, API Gateway, DynamoDB)
- **Vercel Account**: Hobby plan (gratis)
- **GitHub Account**: Para versionado y CI/CD (opcional)
- **Dominio** (opcional): `trueauth.io` (~$10/año)

### Herramientas de Desarrollo

- **Node.js 18+**: Runtime para TypeScript
- **AWS CLI**: Para interactuar con AWS
- **Vercel CLI**: Para deploys
- **VS Code**: Editor recomendado
- **Postman/Insomnia**: Para testing de APIs
- **wscat**: Para testing de WebSocket

### Librerías y Frameworks

- **AWS SDK v3**: `@aws-sdk/client-dynamodb`, `@aws-sdk/client-apigatewaymanagementapi`
- **Vite**: Build tool para frontends
- **React/Vue/Svelte**: Para portal SaaS (elegir uno)
- **TailwindCSS**: Para estilos rápidos
- **Chart.js/Recharts**: Para gráficos de métricas
- **html5-qrcode**: Para scanner QR en mobile

---

## Métricas de Éxito

### Técnicas

- **Latencia Lambda**: < 500ms (p95)
- **WebSocket latency**: < 200ms (ida y vuelta)
- **Bundle size SDK**: < 50KB gzipped
- **Lighthouse score**: > 90 (todos los frontends)
- **Uptime**: > 99% (AWS SLA)

### Negocio

- **Tiempo de autenticación**: < 5 segundos (QR → verify)
- **Tasa de éxito**: > 95% (autenticaciones exitosas / intentos)
- **Costo mensual**: $0 (Free Tier)
- **Developers registrados**: Meta 10 en primer mes
- **Apps creadas**: Meta 20 en primer mes

---

## Próximos Pasos (Post-Sprint)

1. **Implementaciones nativas de KeyStore:** Secure Enclave (iOS) y Keystore (Android)
2. **Rotación de claves:** Renovar llaves maestras periódicamente
3. **Multi-dispositivo:** Soporte para múltiples notebooks simultáneas
4. **Rate limiting:** Prevenir abuso del endpoint /api/verify
5. **SDK móvil:** Librerías nativas iOS/Android
6. **OAuth 2.0:** Integración con proveedores de identidad
7. **Biometría avanzada:** Soporte para múltiples modalidades (voz, rostro, huella)
8. **Certificación de seguridad:** Auditoría profesional (SOC 2, ISO 27001)

---

**Documento mantenido por:** TrueAuth Core Team  
**Última actualización:** Julio 2026
