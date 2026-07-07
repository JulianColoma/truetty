# Configuración HTTPS/WSS

Guía para configurar HTTPS y WebSocket Secure (WSS) en KeyPass Auth.

## 🎯 ¿Por qué HTTPS?

HTTPS es **obligatorio** para:
- ✅ Usar la cámara del celular en todos los navegadores
- ✅ Acceder a WebCrypto API en producción
- ✅ Proteger las claves criptográficas en tránsito
- ✅ Cumplir con requisitos de seguridad modernos

## 🔐 Opción 1: Certificados Auto-Firmados (Desarrollo)

### Generar certificados

```bash
npm run gen-certs
```

Esto crea:
- `certs/key.pem` - Clave privada
- `certs/cert.pem` - Certificado público

### Iniciar servidor HTTPS

```bash
npm run dev:https
```

El servidor arranca en `https://localhost:3443`

### Acceder desde la red local

```bash
# Obtener IP
npm run ip

# Acceder desde el celular
https://<IP>:3443/mobile/
```

### ⚠️ Advertencia del navegador

Los certificados auto-firmados generan una advertencia de seguridad:

**Chrome:**
1. Click en "Configuración avanzada"
2. Click en "Continuar a localhost (no seguro)"
3. Click en "Permitir" para cámara

**Safari (iOS):**
1. Click en "Mostrar detalles"
2. Click en "Visitar este sitio web"
3. Click en "Visitar"

**Firefox:**
1. Click en "Avanzado"
2. Click en "Aceptar el riesgo y continuar"

### Agregar más IPs/dominios al certificado

Editá `src/scripts/generate-certs.ts` y modificá la línea:

```typescript
"-addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.0.8'",
```

Agregá las IPs de tu red:

```typescript
"-addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.100,IP:192.168.1.101'",
```

Luego regenerá los certificados:

```bash
npm run gen-certs
```

## 🌐 Opción 2: Let's Encrypt (Producción)

Para producción, usá certificados reales de Let's Encrypt (gratis).

### Requisitos
- Dominio público (ej: `keypass.tudominio.com`)
- Servidor accesible desde internet
- Certbot instalado

### Generar certificados con Certbot

```bash
# Instalar Certbot (Ubuntu/Debian)
sudo apt-get install certbot

# Generar certificado
sudo certbot certonly --standalone -d keypass.tudominio.com
```

Los certificados se guardan en:
- `/etc/letsencrypt/live/keypass.tudominio.com/privkey.pem`
- `/etc/letsencrypt/live/keypass.tudominio.com/fullchain.pem`

### Configurar el servidor

Copiá los certificados a `certs/`:

```bash
sudo cp /etc/letsencrypt/live/keypass.tudominio.com/privkey.pem certs/key.pem
sudo cp /etc/letsencrypt/live/keypass.tudominio.com/fullchain.pem certs/cert.pem
sudo chown $USER:$USER certs/*.pem
```

### Renovación automática

Certbot renueva automáticamente los certificados. Para forzar renovación:

```bash
sudo certbot renew
```

## 🔄 Opción 3: Reverse Proxy con Nginx

Usá Nginx como reverse proxy para manejar HTTPS.

### Configuración de Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name keypass.tudominio.com;

    ssl_certificate /etc/letsencrypt/live/keypass.tudominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/keypass.tudominio.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name keypass.tudominio.com;
    return 301 https://$server_name$request_uri;
}
```

### Iniciar servicios

```bash
# Iniciar KeyPass Auth (HTTP)
npm run dev

# Iniciar Nginx
sudo systemctl start nginx
sudo systemctl enable nginx
```

## 📱 Opción 4: Túnel HTTPS con ngrok

Para testing rápido sin configurar dominios.

### Instalar ngrok

```bash
# Descargar desde: https://ngrok.com/download
# O instalar con npm
npm install -g ngrok
```

### Crear túnel

```bash
# Iniciar servidor HTTP
npm run dev

# En otra terminal, crear túnel
ngrok http 3000
```

ngrok proporciona una URL HTTPS pública:
```
https://abc123def456.ngrok.io
```

### Usar la URL de ngrok

- Notebook: `https://abc123def456.ngrok.io/notebook/`
- Celular: `https://abc123def456.ngrok.io/mobile/`

**Ventajas:**
- ✅ HTTPS automático
- ✅ Accesible desde cualquier lugar
- ✅ No requiere configuración de red

**Desventajas:**
- ⚠️ URL cambia cada vez que reinicias ngrok (plan gratuito)
- ⚠️ Latencia adicional
- ⚠️ Dependencia de servicio externo

## 🔧 Configuración del Frontend

El frontend detecta automáticamente el protocolo:

```typescript
// src/frontend/notebook/main.ts
function getWSUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/ws`;
}
```

No necesitás cambiar nada en el frontend.

## 🧪 Testing HTTPS

### Verificar que HTTPS funciona

```bash
curl -k https://localhost:3443/api/health
```

Deberías ver:
```json
{
  "status": "ok",
  "servicio": "KeyPass Auth Server (HTTPS)",
  "tls": true,
  ...
}
```

### Verificar WebSocket Secure

```bash
# Usar wscat
npm install -g wscat
wscat -c wss://localhost:3443/ws --no-check
```

### Probar cámara en el celular

1. Abrí `https://<IP>:3443/mobile/` en el celular
2. Aceptá el certificado (si es auto-firmado)
3. Permití acceso a la cámara
4. La cámara debería activarse sin problemas

## 🔐 Consideraciones de Seguridad

### Certificados auto-firmados
- ✅ OK para desarrollo/testing
- ❌ NO usar en producción
- ❌ Los navegadores muestran advertencias
- ❌ No validados por CA confiable

### Let's Encrypt
- ✅ Gratis y automático
- ✅ Validado por CA confiable
- ✅ Sin advertencias del navegador
- ✅ Renovación automática cada 90 días

### Reverse Proxy (Nginx)
- ✅ Maneja HTTPS eficientemente
- ✅ Puede agregar rate limiting
- ✅ Cache y compresión
- ✅ Logs de acceso

### ngrok
- ✅ Rápido para testing
- ✅ HTTPS automático
- ⚠️ URL temporal (plan gratuito)
- ⚠️ Dependencia de servicio externo

## 📚 Recursos

- [Let's Encrypt](https://letsencrypt.org/)
- [Certbot](https://certbot.eff.org/)
- [Nginx SSL Configuration](https://nginx.org/en/docs/http/configuring_https_servers.html)
- [ngrok](https://ngrok.com/)
- [MDN: Secure Context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts)

---

**Recomendación:** Para desarrollo, usá certificados auto-firmados. Para producción, usá Let's Encrypt con Nginx como reverse proxy.
