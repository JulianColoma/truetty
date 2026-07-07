# Guía de KeyStore - Almacenamiento Seguro de Claves

## 🎯 Introducción

El sistema KeyPass Auth utiliza una abstracción de KeyStore para almacenar claves criptográficas de forma segura. Esta abstracción permite diferentes implementaciones según la plataforma, manteniendo la misma interfaz.

## ⚠️ ADVERTENCIA DE SEGURIDAD

**La implementación actual (WebKeyStore) usa localStorage y NO es segura para producción.**

- ✅ **OK para**: Desarrollo, testing, demostraciones
- ❌ **NO usar en**: Producción, datos sensibles, usuarios reales

Para producción, **DEBES** usar:
- **iOS**: Secure Enclave
- **Android**: Keystore
- **Web**: WebAuthn/TPM (si está disponible)

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────┐
│         Interfaz IKeyStore              │
│  (Define métodos abstractos)            │
└─────────────────────────────────────────┘
                  │
        ┌─────────┼─────────┐
        │         │         │
        ▼         ▼         ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │  Web   │ │  iOS   │ │Android │
   │(localS)│ │(Secure │ │(Keysto │
   │        │ │Enclave)│ │  re)   │
   └────────┘ └────────┘ └────────┘
   ⚠️ Demo    ✅ Seguro  ✅ Seguro
```

## 📝 Uso Básico

### 1. Crear instancia de KeyStore

```typescript
import { createKeyStore } from "./shared/keystore.js";

const keyStore = createKeyStore();
```

### 2. Generar una clave maestra

```typescript
const resultado = await keyStore.generarClave(
  "master-key-001",     // ID único
  "ECDSA",              // Algoritmo
  "P-256",              // Curva
  "master-key"          // Propósito
);

if (resultado.exito) {
  console.log("Clave generada:", resultado.data);
}
```

### 3. Obtener clave pública

```typescript
const resultado = await keyStore.obtenerClavePublica("master-key-001");

if (resultado.exito) {
  const clavePublica = resultado.data; // JWK
  console.log("Clave pública:", clavePublica);
}
```

### 4. Firmar datos

```typescript
const datos = new TextEncoder().encode("Mensaje a firmar");
const resultado = await keyStore.firmar(
  "master-key-001",
  datos.buffer,
  { name: "ECDSA", hash: "SHA-256" }
);

if (resultado.exito) {
  const firma = resultado.data; // ArrayBuffer
  console.log("Firma:", firma);
}
```

### 5. Verificar si una clave existe

```typescript
const existe = await keyStore.existeClave("master-key-001");
console.log("¿Existe?", existe);
```

### 6. Listar todas las claves

```typescript
const resultado = await keyStore.listarClaves();

if (resultado.exito) {
  resultado.data.forEach((clave) => {
    console.log(`- ${clave.id} (${clave.algoritmo} ${clave.curva})`);
  });
}
```

### 7. Eliminar una clave

```typescript
const resultado = await keyStore.eliminarClave("master-key-001");

if (resultado.exito) {
  console.log("Clave eliminada");
}
```

## 🔐 Implementaciones

### Web (localStorage) - Solo para Demo

**Archivo**: `src/shared/keystore.ts` - Clase `WebKeyStore`

**Características**:
- ✅ Fácil de implementar y testear
- ✅ Funciona en todos los navegadores
- ❌ **NO seguro**: Las claves pueden ser accedidas por JavaScript
- ❌ **NO persistente**: Se pierden si el usuario limpia el almacenamiento

**Uso**:
```typescript
import { WebKeyStore } from "./shared/keystore.js";
const keyStore = new WebKeyStore();
```

### iOS (Secure Enclave) - Producción

**Requiere**: Implementación nativa en Swift/Objective-C

**Características**:
- ✅ **Máxima seguridad**: Claves nunca salen del hardware
- ✅ **Resistente a ataques**: Protegido contra extracción física
- ✅ **Biometría**: Puede requerir Face ID/Touch ID
- ❌ Solo disponible en iOS

**Implementación nativa (Swift)**:

```swift
import Security
import LocalAuthentication

@objc(KeyPassKeyStore)
class KeyPassKeyStore: NSObject {
    
    @objc func generarClave(
        _ id: String,
        algoritmo: String,
        curva: String,
        proposito: String,
        resolver: @escaping RCTPromiseResolveBlock,
        rejecter: @escaping RCTPromiseRejectBlock
    ) {
        let access = SecAccessControlCreateWithFlags(
            nil,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            .privateKeyUsage,
            nil
        )
        
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecAttrAccessControl as String: access!
        ]
        
        var error: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
            rejecter("ERROR", error?.takeRetainedValue().localizedDescription, nil)
            return
        }
        
        // Guardar referencia y retornar metadatos
        let metadata = [
            "id": id,
            "algoritmo": algoritmo,
            "curva": curva,
            "creado_en": Date().timeIntervalSince1970 * 1000,
            "proposito": proposito,
            "plataforma": "ios-secure-enclave"
        ]
        
        resolver(metadata)
    }
    
    @objc func firmar(
        _ id: String,
        datos: String,
        resolver: @escaping RCTPromiseResolveBlock,
        rejecter: @escaping RCTPromiseRejectBlock
    ) {
        // Obtener clave privada del Secure Enclave
        // Firmar datos
        // Retornar firma
    }
}
```

**Bridge React Native**:

```typescript
import { NativeModules } from "react-native";
const { KeyPassKeyStore } = NativeModules;

export class IOSSecureEnclaveKeyStore implements IKeyStore {
  async generarClave(id: string, algoritmo: string, curva: string, proposito: string) {
    return await KeyPassKeyStore.generarClave(id, algoritmo, curva, proposito);
  }
  
  async firmar(id: string, datos: ArrayBuffer, algoritmo: any) {
    const datosBase64 = btoa(String.fromCharCode(...new Uint8Array(datos)));
    return await KeyPassKeyStore.firmar(id, datosBase64);
  }
  
  // ... otros métodos
}
```

### Android (Keystore) - Producción

**Requiere**: Implementación nativa en Kotlin/Java

**Características**:
- ✅ **Alta seguridad**: Claves protegidas por hardware (TEE)
- ✅ **Biometría**: Puede requerir huella digital
- ✅ **Resistente a ataques**: Protegido contra root
- ❌ Solo disponible en Android

**Implementación nativa (Kotlin)**:

```kotlin
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore

class KeyPassKeyStore {
    
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply {
        load(null)
    }
    
    fun generarClave(
        id: String,
        algoritmo: String,
        curva: String,
        proposito: String
    ): Map<String, Any> {
        val keyPairGenerator = KeyPairGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_EC,
            "AndroidKeyStore"
        )
        
        val builder = KeyGenParameterSpec.Builder(
            id,
            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
        )
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setUserAuthenticationRequired(true)
            .setUserAuthenticationParameters(
                30, // 30 segundos
                KeyProperties.AUTH_BIOMETRIC_STRONG
            )
        
        keyPairGenerator.initialize(builder.build())
        val keyPair = keyPairGenerator.generateKeyPair()
        
        return mapOf(
            "id" to id,
            "algoritmo" to algoritmo,
            "curva" to curva,
            "creado_en" to System.currentTimeMillis(),
            "proposito" to proposito,
            "plataforma" to "android-keystore"
        )
    }
    
    fun firmar(id: String, datos: ByteArray): ByteArray {
        val entry = keyStore.getEntry(id, null) as KeyStore.PrivateKeyEntry
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(entry.privateKey)
        signature.update(datos)
        return signature.sign()
    }
}
```

**Bridge React Native**:

```typescript
import { NativeModules } from "react-native";
const { KeyPassKeyStore } = NativeModules;

export class AndroidKeystoreKeyStore implements IKeyStore {
  async generarClave(id: string, algoritmo: string, curva: string, proposito: string) {
    return await KeyPassKeyStore.generarClave(id, algoritmo, curva, proposito);
  }
  
  async firmar(id: string, datos: ArrayBuffer, algoritmo: any) {
    const datosBase64 = btoa(String.fromCharCode(...new Uint8Array(datos)));
    return await KeyPassKeyStore.firmar(id, datosBase64);
  }
  
  // ... otros métodos
}
```

## 🔄 Migración a Producción

### Paso 1: Detectar plataforma

```typescript
import { Platform } from "react-native";

function createProductionKeyStore(): IKeyStore {
  if (Platform.OS === "ios") {
    return new IOSSecureEnclaveKeyStore();
  } else if (Platform.OS === "android") {
    return new AndroidKeystoreKeyStore();
  } else {
    throw new Error("Plataforma no soportada para producción");
  }
}
```

### Paso 2: Migrar claves existentes

```typescript
async function migrarClaves(keyStoreDemo: IKeyStore, keyStoreProd: IKeyStore) {
  const claves = await keyStoreDemo.listarClaves();
  
  for (const clave of claves.data!) {
    // Generar nueva clave en hardware seguro
    await keyStoreProd.generarClave(
      clave.id,
      clave.algoritmo,
      clave.curva,
      clave.proposito
    );
    
    // Eliminar clave del almacenamiento inseguro
    await keyStoreDemo.eliminarClave(clave.id);
  }
}
```

### Paso 3: Verificar seguridad

```typescript
const keyStore = createProductionKeyStore();

if (!keyStore.esSeguro()) {
  throw new Error("KeyStore no es seguro para producción");
}

console.log("✅ KeyStore seguro:", keyStore.getPlataforma());
```

## 🛡️ Mejores Prácticas de Seguridad

### 1. Nunca exportar claves privadas

```typescript
// ❌ MAL: Exportar clave privada
const privateJWK = await crypto.subtle.exportKey("jwk", privateKey);

// ✅ BIEN: Usar KeyStore que mantiene la clave en hardware seguro
const resultado = await keyStore.firmar(id, datos, algoritmo);
```

### 2. Requerir autenticación biométrica

```typescript
// iOS
const access = SecAccessControlCreateWithFlags(
    nil,
    kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    .biometryCurrentSet, // Requiere Face ID/Touch ID
    nil
);

// Android
val builder = KeyGenParameterSpec.Builder(id, purpose)
    .setUserAuthenticationRequired(true)
    .setUserAuthenticationParameters(
        30,
        KeyProperties.AUTH_BIOMETRIC_STRONG
    )
```

### 3. Validar integridad del dispositivo

```typescript
// iOS: Verificar que el dispositivo no tiene jailbreak
if (isJailbroken()) {
  throw new Error("Dispositivo comprometido");
}

// Android: Verificar que el dispositivo no tiene root
if (isRooted()) {
  throw new Error("Dispositivo comprometido");
}
```

### 4. Rotar claves periódicamente

```typescript
async function rotarClaves(keyStore: IKeyStore) {
  const claves = await keyStore.listarClaves();
  
  for (const clave of claves.data!) {
    const edad = Date.now() - clave.creado_en;
    const edadDias = edad / (1000 * 60 * 60 * 24);
    
    if (edadDias > 90) { // 90 días
      console.log(`Rotando clave ${clave.id} (${edadDias} días)`);
      
      // Generar nueva clave
      await keyStore.generarClave(
        `${clave.id}-v2`,
        clave.algoritmo,
        clave.curva,
        clave.proposito
      );
      
      // Eliminar clave antigua
      await keyStore.eliminarClave(clave.id);
    }
  }
}
```

## 📚 Recursos

- [WebCrypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [iOS Secure Enclave](https://developer.apple.com/documentation/security/certificate_key_and_trust_services/keys/storing_keys_in_the_secure_enclave)
- [Android Keystore](https://developer.android.com/training/articles/keystore)
- [React Native Native Modules](https://reactnative.dev/docs/native-modules-intro)

---

**Nota**: Esta documentación es una guía. La implementación de Secure Enclave y Keystore requiere conocimientos de desarrollo nativo iOS/Android y debe ser revisada por expertos en seguridad antes de usar en producción.
