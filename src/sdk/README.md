# KeyPass Auth SDK

SDK de Frontend autocontenido para integrar autenticación KeyPass en cualquier sitio web.

## 🚀 Instalación

### Opción 1: Script Tag (Recomendado)

```html
<!-- 1. Agregar contenedor -->
<div id="keypass-widget"></div>

<!-- 2. Incluir SDK -->
<script src="https://tu-cdn.com/keypass-sdk.js"></script>

<!-- 3. Inicializar -->
<script>
  KeyPassSDK.init({
    elementId: 'keypass-widget',
    serverUrl: 'https://localhost:3443',
    onSuccess: (token) => {
      console.log('Token JWT:', token);
      // Guardar token, enviar a tu backend, etc.
    },
    onError: (error) => {
      console.error('Error:', error);
    }
  });
</script>
```

### Opción 2: npm (para proyectos con bundler)

```bash
npm install keypass-auth-sdk
```

```javascript
import KeyPassSDK from 'keypass-auth-sdk';

KeyPassSDK.init({
  elementId: 'keypass-widget',
  serverUrl: 'https://localhost:3443',
  onSuccess: (token) => {
    console.log('Token JWT:', token);
  }
});
```

## 📖 API

### `KeyPassSDK.init(config)`

Inicializa el SDK y comienza el flujo de autenticación.

**Parámetros:**

```typescript
interface SDKConfig {
  /** ID del elemento DOM donde se renderizará el widget */
  elementId: string;
  
  /** URL del servidor backend (ej: https://localhost:3443) */
  serverUrl: string;
  
  /** Callback ejecutado cuando la autenticación es exitosa */
  onSuccess: (sessionToken: string) => void;
  
  /** Callback ejecutado cuando ocurre un error (opcional) */
  onError?: (error: Error) => void;
}
```

**Retorna:** Instancia del SDK

**Ejemplo:**

```javascript
const sdk = KeyPassSDK.init({
  elementId: 'keypass-widget',
  serverUrl: 'https://localhost:3443',
  onSuccess: (token) => {
    // 1. Guardar token en localStorage
    localStorage.setItem('sessionToken', token);
    
    // 2. Enviar a tu backend
    fetch('/api/login', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    // 3. Redirigir al dashboard
    window.location.href = '/dashboard';
  },
  onError: (error) => {
    alert(`Error: ${error.message}`);
  }
});
```

### `sdk.destroy()`

Limpia el SDK y libera recursos.

**Ejemplo:**

```javascript
sdk.destroy();
```

## 🔄 Flujo de Autenticación

1. **Inicialización**: El SDK se inicializa con la configuración
2. **Conexión**: Se conecta al servidor WebSocket
3. **Generación de Claves**: Genera claves efímeras ECDSA P-256
4. **QR Code**: Muestra un código QR con la clave pública
5. **Escaneo**: El usuario escanea el QR con su celular
6. **Delegación**: El celular firma y envía la delegación
7. **Verificación**: El SDK envía la delegación al backend
8. **Token**: Si es válido, recibe el JWT y ejecuta `onSuccess`

## 🎨 Personalización

El widget incluye estilos CSS por defecto. Puedes personalizarlos sobrescribiendo las clases:

```css
.keypass-widget {
  /* Tu estilo personalizado */
  border: 2px solid #6366f1;
  border-radius: 16px;
}

.keypass-header h3 {
  color: #6366f1;
}
```

## 📦 Archivos Generados

Después de ejecutar `npm run build:sdk`, se generan:

- `dist/sdk/keypass-sdk.js` - Versión UMD (para script tags)
- `dist/sdk/keypass-sdk.mjs` - Versión ES Module (para bundlers)
- `dist/sdk/keypass-sdk.js.map` - Source map
- `dist/sdk/keypass-sdk.mjs.map` - Source map

## 🔧 Desarrollo

### Compilar el SDK

```bash
npm run build:sdk
```

### Probar el SDK

Abre `src/sdk/example.html` en tu navegador:

```bash
# Iniciar servidor de desarrollo
npx serve src/sdk
```

## 🛡️ Seguridad

- Las claves privadas **nunca** salen del navegador
- La comunicación usa WebSocket Secure (WSS) en producción
- Los tokens JWT están firmados con ECDSA P-256
- Las sesiones expiran automáticamente (2 horas por defecto)

## 📝 Ejemplo Completo

```html
<!DOCTYPE html>
<html>
<head>
  <title>Mi Sitio con KeyPass Auth</title>
</head>
<body>
  <h1>Bienvenido a Mi Sitio</h1>
  
  <!-- Widget de autenticación -->
  <div id="keypass-widget"></div>
  
  <!-- Incluir SDK -->
  <script src="keypass-sdk.js"></script>
  
  <script>
    // Inicializar SDK
    KeyPassSDK.init({
      elementId: 'keypass-widget',
      serverUrl: 'https://localhost:3443',
      onSuccess: async (token) => {
        console.log('✅ Autenticación exitosa');
        
        // Guardar token
        localStorage.setItem('token', token);
        
        // Verificar token con tu backend
        const response = await fetch('/api/verify', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
          // Redirigir al dashboard
          window.location.href = '/dashboard';
        }
      },
      onError: (error) => {
        console.error('❌ Error:', error);
        alert('Error de autenticación. Intenta de nuevo.');
      }
    });
  </script>
</body>
</html>
```

## 🐛 Troubleshooting

### El widget no aparece

- Verifica que el `elementId` exista en el DOM
- Revisa la consola del navegador por errores
- Asegúrate de que el SDK se cargó correctamente

### Error de conexión WebSocket

- Verifica que el servidor esté corriendo
- Confirma que `serverUrl` es correcta
- Revisa que el firewall permita la conexión

### El QR no se genera

- Verifica que el navegador soporte WebCrypto API
- Revisa la consola por errores de generación de claves

## 📚 Recursos

- [Documentación Principal](../README.md)
- [Guía de HTTPS](../docs/HTTPS_SETUP.md)
- [Testing con Dispositivos Reales](../docs/TESTING_REAL_DEVICES.md)

## 📄 Licencia

MIT
