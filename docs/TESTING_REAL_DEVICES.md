# Testing con Dispositivos Reales

Guía completa para probar KeyPass Auth con dispositivos reales (notebook + celular) en la misma red local.

## 📋 Requisitos

- **Notebook/Laptop** con navegador moderno (Chrome, Firefox, Edge, Safari)
- **Celular** con navegador moderno y cámara funcional
- **Red WiFi común** donde ambos dispositivos estén conectados
- **Node.js 18+** instalado en la notebook

## 🚀 Inicio Rápido

### 1. Obtener IPs y URLs de acceso

```bash
npm run ip
```

Este comando muestra:
- Las IPs locales de tu notebook
- Las URLs exactas para abrir en cada dispositivo
- Instrucciones de troubleshooting

### 2. Iniciar servidor accesible desde la red

```bash
npm run dev:network
```

El servidor se inicia accesible desde cualquier dispositivo en la red local.

### 3. Abrir las URLs en cada dispositivo

**En la notebook:**
```
http://<IP-NOTEBOOK>:3000/notebook/
```

**En el celular:**
```
http://<IP-NOTEBOOK>:3000/mobile/
```

### 4. Escanear el QR

1. La notebook muestra un código QR
2. El celular abre la cámara automáticamente
3. Apuntá el celular al QR de la notebook
4. ¡Listo! La sesión se autoriza automáticamente

## 🔧 Configuración Detallada

### Verificar conectividad de red

Ambos dispositivos deben estar en la **misma red WiFi**. Para verificar:

**En Windows (notebook):**
```cmd
ipconfig
```
Busca "Dirección IPv4" (ej: 192.168.1.100)

**En macOS/Linux (notebook):**
```bash
ifconfig | grep inet
# o
ip addr show
```

**En el celular:**
- Android: Ajustes → WiFi → Detalles de la red → Dirección IP
- iOS: Ajustes → WiFi → (i) junto a la red → Dirección IP

Ambos dispositivos deben tener IPs en el mismo rango (ej: 192.168.1.x)

### Probar conectividad

Desde el celular, probá acceder a la notebook:

```
http://192.168.1.100:3000/api/health
```

Deberías ver un JSON con el estado del servidor.

### Configurar el firewall

**Windows:**
1. Panel de Control → Sistema y Seguridad → Firewall de Windows
2. Configuración avanzada → Reglas de entrada → Nueva regla
3. Puerto → TCP → Puerto específico: 3000
4. Permitir la conexión → Aplicar a todos los perfiles

**macOS:**
```bash
# Permitir conexiones entrantes para Node.js
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add /usr/local/bin/node
sudo /usr/libexec/ApplicationFirewall/socketfilterfw --unblockapp /usr/local/bin/node
```

**Linux (ufw):**
```bash
sudo ufw allow 3000/tcp
```

## 📷 Problemas con la Cámara

La cámara del celular requiere **HTTPS** en la mayoría de los navegadores modernos, excepto en redes locales (localhost o IPs privadas).

### Si la cámara no funciona:

**Opción 1: Usar HTTP en red local (testing)**
- Los navegadores permiten HTTP en IPs privadas (192.168.x.x, 10.x.x.x)
- Asegurate de que la URL sea exactamente `http://<IP>:3000/mobile/`
- Algunos navegadores pueden requerir permisos explícitos

**Opción 2: Configurar HTTPS (recomendado para producción)**
Ver [HTTPS_SETUP.md](./HTTPS_SETUP.md) para instrucciones detalladas.

**Opción 3: Usar ngrok (túnel HTTPS)**
```bash
# Instalar ngrok: https://ngrok.com/download
ngrok http 3000
```
Usar la URL HTTPS que proporciona ngrok (ej: `https://abc123.ngrok.io`)

## 🧪 Checklist de Testing

Antes de probar, verificá:

- [ ] Ambos dispositivos están en la misma red WiFi
- [ ] El servidor está corriendo (`npm run dev:network`)
- [ ] El firewall permite conexiones al puerto 3000
- [ ] Podés acceder a `http://<IP>:3000/api/health` desde el celular
- [ ] La notebook puede abrir `http://<IP>:3000/notebook/`
- [ ] El celular puede abrir `http://<IP>:3000/mobile/`
- [ ] El navegador del celular tiene permisos de cámara
- [ ] La pantalla de la notebook tiene brillo suficiente para el QR

## 🐛 Troubleshooting

### El celular no puede conectar al servidor

**Síntoma:** "No se puede conectar" o timeout

**Soluciones:**
1. Verificá que ambos dispositivos estén en la misma red WiFi
2. Verificá que la IP sea correcta (usá `npm run ip`)
3. Desactivá temporalmente el firewall/antivirus
4. Probá con otra IP si tenés múltiples interfaces de red
5. Reiniciá el router WiFi

### La cámara no se activa en el celular

**Síntoma:** "No se pudo acceder a la cámara" o pantalla negra

**Soluciones:**
1. Verificá los permisos de cámara del navegador
2. Cerrá otras apps que estén usando la cámara
3. Probá con otro navegador (Chrome recomendado)
4. Usá HTTPS (ver [HTTPS_SETUP.md](./HTTPS_SETUP.md))
5. Recargá la página con `Ctrl+Shift+R` (hard reload)

### El QR no se escanea

**Síntoma:** La cámara no detecta el QR

**Soluciones:**
1. Aumentá el brillo de la pantalla de la notebook al máximo
2. Acerca el celular al QR (20-30 cm de distancia)
3. Asegurate de que el QR esté completo y no distorsionado
4. Limpiá la cámara del celular
5. Probá en un ambiente con mejor iluminación
6. Reducí el tamaño del QR en el CSS si es muy grande

### La delegación no se completa

**Síntoma:** El celular escanea pero no se autoriza la sesión

**Soluciones:**
1. Verificá la consola del navegador (F12) en ambos dispositivos
2. Verificá los logs del servidor en la terminal
3. Asegurate de que el WebSocket esté conectado (ver logs)
4. Verificá que la hora del celular sea correcta (afecta expiración)
5. Recargá ambas páginas y probá de nuevo

### Error de firma criptográfica

**Síntoma:** "Firma inválida" en los logs del servidor

**Soluciones:**
1. Verificá que la hora del celular y notebook estén sincronizadas
2. Asegurate de que el payload JSON sea idéntico (sin espacios extra)
3. Verificá que la llave maestra no esté corrupta (borrá localStorage)
4. Revisá los logs detallados del servidor

## 📊 Monitoreo

### Ver logs del servidor

El servidor muestra logs en tiempo real:
- 🏠 Creación de salas
- 📱 Conexión de celulares
- 📦 Retransmisión de delegaciones
- 🔍 Verificación criptográfica

### Ver estado de salas

```bash
curl http://localhost:3000/api/health
```

Muestra:
- Total de salas activas
- Notebooks conectadas
- Celulares conectados

### Debug en el navegador

**Notebook:**
1. Abrí DevTools (F12)
2. Pestaña Console
3. Filtrá por "[NOTEBOOK]"

**Celular:**
1. Conectá el celular por USB
2. Chrome: `chrome://inspect/#devices`
3. Safari: Develop → Dispositivo
4. Ver logs en tiempo real

## 🎯 Casos de Prueba

### Caso 1: Flujo normal exitoso
1. Notebook genera QR
2. Celular escanea QR
3. Celular firma y envía delegación
4. Servidor verifica y autoriza
5. Notebook muestra "Sesión Autorizada"

### Caso 2: QR expirado
1. Notebook genera QR
2. Esperá más de 2 horas
3. Celular escanea QR
4. Servidor rechaza por expiración
5. Notebook muestra error

### Caso 3: Firma inválida
1. Notebook genera QR
2. Celular escanea QR
3. Modificá el payload manualmente (simular ataque)
4. Servidor rechaza firma inválida
5. Notebook muestra error

### Caso 4: Múltiples celulares
1. Notebook genera QR
2. Celular 1 escanea y autoriza
3. Celular 2 escanea el mismo QR
4. Servidor procesa ambas delegaciones
5. Notebook recibe ambas (la última sobrescribe)

## 🔐 Consideraciones de Seguridad

### En red local (testing)
- ✅ Aceptable para desarrollo y testing
- ⚠️ No usar en producción sin HTTPS
- ⚠️ Las claves se transmiten en texto plano (HTTP)

### Para producción
- ✅ Usar HTTPS/WSS obligatorio
- ✅ Validar certificados TLS
- ✅ Implementar rate limiting
- ✅ Agregar autenticación de servidores
- ✅ Auditar logs de seguridad

## 📚 Recursos Adicionales

- [Configuración HTTPS](./HTTPS_SETUP.md)
- [Documentación principal](../README.md)
- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)

---

**¿Necesitás ayuda?** Revisá los logs del servidor y las consolas de los navegadores. La mayoría de los problemas se pueden diagnosticar con esa información.
