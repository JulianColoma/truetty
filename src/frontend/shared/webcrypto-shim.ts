/**
 * WebCrypto Shim
 * 
 * Provee una API compatible con crypto.subtle usando @noble/curves como fallback
 * cuando crypto.subtle no está disponible (ej: HTTP en red local).
 */

import { p256 } from "@noble/curves/nist.js";

interface ShimCryptoKeyPair {
  privateKey: ShimCryptoKey;
  publicKey: ShimCryptoKey;
}

interface ShimCryptoKey {
  type: "private" | "public";
  extractable: boolean;
  algorithm: { name: string; namedCurve: string };
  usages: string[];
  _keyData: Uint8Array;
}

interface JWK {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d?: string;
  key_ops?: string[];
  ext?: boolean;
}

function base64UrlEncode(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

const shimSubtle = {
  async generateKey(
    algorithm: { name: string; namedCurve: string },
    extractable: boolean,
    keyUsages: string[]
  ): Promise<ShimCryptoKeyPair> {
    if (algorithm.name !== "ECDSA" || algorithm.namedCurve !== "P-256") {
      throw new Error("Solo se soporta ECDSA P-256");
    }

    const { secretKey, publicKey } = p256.keygen();
    
    return {
      privateKey: {
        type: "private",
        extractable,
        algorithm: { name: "ECDSA", namedCurve: "P-256" },
        usages: ["sign"],
        _keyData: secretKey,
      },
      publicKey: {
        type: "public",
        extractable,
        algorithm: { name: "ECDSA", namedCurve: "P-256" },
        usages: ["verify"],
        _keyData: publicKey,
      },
    };
  },

  async importKey(
    format: string,
    keyData: JWK | Uint8Array,
    algorithm: { name: string; namedCurve: string },
    extractable: boolean,
    keyUsages: string[]
  ): Promise<ShimCryptoKey> {
    if (format !== "jwk") {
      throw new Error("Solo se soporta formato JWK");
    }

    if (algorithm.name !== "ECDSA" || algorithm.namedCurve !== "P-256") {
      throw new Error("Solo se soporta ECDSA P-256");
    }

    const jwk = keyData as JWK;
    
    if (jwk.d) {
      const privateKeyBytes = base64UrlDecode(jwk.d);
      return {
        type: "private",
        extractable,
        algorithm: { name: "ECDSA", namedCurve: "P-256" },
        usages: keyUsages,
        _keyData: privateKeyBytes,
      };
    } else {
      const x = base64UrlDecode(jwk.x);
      const y = base64UrlDecode(jwk.y);
      const publicKeyBytes = new Uint8Array(65);
      publicKeyBytes[0] = 0x04;
      publicKeyBytes.set(x, 1);
      publicKeyBytes.set(y, 33);
      
      return {
        type: "public",
        extractable,
        algorithm: { name: "ECDSA", namedCurve: "P-256" },
        usages: keyUsages,
        _keyData: publicKeyBytes,
      };
    }
  },

  async exportKey(format: string, key: ShimCryptoKey): Promise<JWK | Uint8Array> {
    if (format !== "jwk") {
      throw new Error("Solo se soporta formato JWK");
    }

    if (key.type === "public") {
      const publicKeyBytes = key._keyData;
      const x = publicKeyBytes.slice(1, 33);
      const y = publicKeyBytes.slice(33, 65);

      return {
        kty: "EC",
        crv: "P-256",
        x: base64UrlEncode(x),
        y: base64UrlEncode(y),
        key_ops: key.usages,
        ext: key.extractable,
      };
    } else {
      const privateKeyBytes = key._keyData;
      const publicKeyBytes = p256.getPublicKey(privateKeyBytes, false);
      const x = publicKeyBytes.slice(1, 33);
      const y = publicKeyBytes.slice(33, 65);

      return {
        kty: "EC",
        crv: "P-256",
        x: base64UrlEncode(x),
        y: base64UrlEncode(y),
        d: base64UrlEncode(privateKeyBytes),
        key_ops: key.usages,
        ext: key.extractable,
      };
    }
  },

  async sign(
    algorithm: { name: string; hash: string },
    key: ShimCryptoKey,
    data: Uint8Array
  ): Promise<Uint8Array> {
    if (algorithm.name !== "ECDSA") {
      throw new Error("Solo se soporta ECDSA");
    }

    const signature = p256.sign(data, key._keyData);
    return signature;
  },

  async verify(
    algorithm: { name: string; hash: string },
    key: ShimCryptoKey,
    signature: Uint8Array,
    data: Uint8Array
  ): Promise<boolean> {
    if (algorithm.name !== "ECDSA") {
      throw new Error("Solo se soporta ECDSA");
    }

    return p256.verify(signature, data, key._keyData);
  },
};

export function getCryptoSubtle(): typeof crypto.subtle {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    return crypto.subtle;
  }
  
  console.warn("⚠️ crypto.subtle no disponible, usando shim con @noble/curves");
  return shimSubtle as unknown as typeof crypto.subtle;
}
