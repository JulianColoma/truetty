# KeyPass Auth - MVP

**Sistema de Autenticación Descentralizada con Portabilidad Criptográfica**

MVP que emula el flujo de vinculación multidispositivo de WhatsApp Web, pero para autenticación web pura usando la **WebCrypto API** nativa del navegador.

## 🎯 Objetivo

Permitir que un usuario autentique una sesión web en una notebook escaneando un código QR con su celular, sin contraseñas, sin tokens compartidos, sin SMS. La seguridad se basa puramente en criptografía de curva elíptica (ECDSA P-256).

## 🏗️ Arquitectura

El sistema tiene 3 componentes principales que interactúan mediante un flujo criptográfico:

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  CLIENTE WEB    │         │  APP MÓVIL      │         │  BACKEND        │
│  (Notebook)     │         │  (Celular)      │         │  (Servidor)     │
│                 │         │                 │         │                 │
│ 1. Genera       │   QR    │ 3. Escanea QR   │  HTTP   │ 5. Verifica     │
│    claves       │────────>│    y extrae     │────────>│    firma        │
│    efímeras     │         │    clave pública│         │    criptográfica│
│    ECDSA P-256  │         │                 │         │                 │
│                 │         │ 4. Firma        │         │ 6. Autoriza     │
│                 │         │    delegación   │         │    sesión       │
└─────────────────┘         └─────────────────┘         └─────────────────┘
```

## 🔐 Flujo Criptográfico

### Fase 1: Cliente Web Esclavo (Notebook)
1. Genera un par de claves efímeras ECDSA P-256 usando `crypto.subtle.generateKey()`
2. Exporta la clave pública en formato JWK (JSON Web Key)
3. Codifica la clave pública en un código QR (simulado como JSON string)

**Propiedad de seguridad:** La clave privada efímera NUNCA sale del navegador.

### Fase 2: App Móvil Maestra (Celular)
1. Escanea el QR y extrae la clave pública efímera de la notebook
2. Crea un payload de delegación: `{ autorizado: publicKeyJWK, expiracion: timestamp }`
3. Firma el payload con su clave privada maestra usando ECDSA-SHA256
4. Envía al backend: payload + firma + clave pública maestra

**Propiedad de seguridad:** La clave privada maestra NUNCA sale del celular (en producción estaría en Secure Enclave/Keystore).

### Fase 3: Verificador Backend (Servidor)
1. Importa la clave pública maestra desde JWK
2. Reconstruye el payload original (mismo JSON canónico)
3. Convierte la firma del formato raw (WebCrypto) a DER (Node.js)
4. Verifica matemáticamente la firma usando `crypto.createVerify()`
5. Verifica que la delegación no haya expirado
6. Autoriza la sesión si todo es válido

**Propiedad de seguridad:** El backend puede probar criptográficamente que el celular autorizó la sesión.

## 📁 Estructura del Proyecto

```
keypass-auth/
├── src/
│   ├── shared/
│   │   ├── types.ts          # Tipos TypeScript compartidos
│   │   └── utils.ts          # Utilidades criptográficas (conversiones)
│   ├── client/
│   │   └── ephemeral-client.ts  # Cliente Web Esclavo
│   ├── mobile/
│   │   └── master-app.ts        # App Móvil Maestra
│   ├── backend/
│   │   └── verifier.ts          # Verificador Backend
│   └── demo.ts                  # Demostración completa
├── package.json
├── tsconfig.json
└── README.md
```

## 🚀 Instalación y Ejecución

### Requisitos
- Node.js 18+ (para WebCrypto API nativa)
- npm o yarn

### Instalación
```bash
npm install
```

### Ejecutar Demo Completa
```bash
npm run demo
```

Esto ejecuta el flujo completo de los 3 componentes y muestra:
- Generación de claves efímeras
- QR simulado
- Delegación criptográfica firmada
- Verificación de firma en backend
- Resultado final de autorización

### Compilar TypeScript
```bash
npm run build
```

## 🔑 Conceptos Criptográficos Clave

### ECDSA (Elliptic Curve Digital Signature Algorithm)
- Algoritmo de firma digital basado en curvas elípticas
- Curva P-256: seguridad equivalente a RSA-3072 con claves mucho más pequeñas
- Propiedades: integridad, autenticidad, no repudio

### JWK (JSON Web Key)
- Estándar RFC 7517 para representar claves criptográficas en JSON
- Permite interoperabilidad entre sistemas
- Contiene coordenadas X, Y de la clave pública

### Formatos de Firma
- **Raw (WebCrypto):** r || s concatenados (64 bytes para P-256)
- **DER (Node.js):** ASN.1 SEQUENCE { INTEGER r, INTEGER s }
- El backend convierte entre formatos para compatibilidad

### Delegación Criptográfica
- El celular "delega" autoridad a la notebook firmando su clave pública
- La firma prueba que el celular autorizó esa clave específica
- La expiración limita la ventana de validez

## 🛡️ Propiedades de Seguridad

✓ **Sin contraseñas:** No hay secretos compartidos que puedan ser robados  
✓ **Sin tokens:** No hay JWTs ni session IDs que puedan ser interceptados  
✓ **Sin SMS:** No hay códigos OTP que puedan ser phishing  
✓ **Claves efímeras:** La notebook tiene claves temporales que expiran  
✓ **Claves maestras protegidas:** El celular nunca expone su clave privada  
✓ **Verificación matemática:** El backend prueba criptográficamente la autorización  
✓ **Expiración temporal:** Las delegaciones tienen ventana de validez limitada  
✓ **Resistencia a replay:** Cada delegación es única y no reutilizable  

## 📊 Comparación con WhatsApp Web

| Característica | WhatsApp Web | KeyPass Auth |
|----------------|--------------|--------------|
| Vinculación | QR + cifrado Signal | QR + ECDSA P-256 |
| Claves maestras | En el celular | En el celular |
| Claves efímeras | En la web | En la web |
| Verificación | Servidor centralizado | Backend del cliente |
| Estándar | Protocolo propietario | WebCrypto API estándar |
| Portabilidad | Solo WhatsApp | Cualquier servicio web |

## 🔮 Próximos Pasos (Post-MVP)

1. **Persistencia de claves maestras:** Integrar con Secure Enclave (iOS) / Keystore (Android)
2. **Rotación de claves:** Mecanismo para renovar claves maestras periódicamente
3. **Revocación de delegaciones:** Endpoint para revocar sesiones activas
4. **Multi-dispositivo:** Soporte para múltiples notebooks simultáneas
5. **Auditoría:** Logs de todas las delegaciones para compliance
6. **SDK móvil:** Librerías nativas para iOS/Android
7. **SDK web:** Librería JavaScript para integrar en cualquier sitio web

## 📚 Referencias

- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [ECDSA (Wikipedia)](https://en.wikipedia.org/wiki/Elliptic_Curve_Digital_Signature_Algorithm)
- [JWK (RFC 7517)](https://tools.ietf.org/html/rfc7517)
- [Node.js Crypto](https://nodejs.org/api/crypto.html)

## 📄 Licencia

MIT

## 👨‍💻 Autor

Desarrollado como MVP educativo para demostrar autenticación descentralizada con criptografía de curva elíptica.

---

**Nota:** Este es un MVP educativo. Para producción, consultar con expertos en seguridad criptográfica y realizar auditorías de seguridad exhaustivas.
