/**
 * GENERADOR DE CERTIFICADOS TLS AUTO-FIRMADOS (node-forge)
 * 
 * Genera certificados TLS usando node-forge (pure JavaScript).
 * NO USAR EN PRODUCCIÓN - solo para desarrollo.
 * 
 * Uso: npm run gen-certs
 */

import forge from "node-forge";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CERTS_DIR = join(process.cwd(), "certs");

/**
 * Genera un certificado auto-firmado usando node-forge
 */
function generateSelfSignedCert(): { key: string; cert: string } {
  console.log("   Generando par de claves RSA (2048 bits)...\n");
  
  // Generar par de claves
  const keys = forge.pki.rsa.generateKeyPair(2048);
  
  console.log("   Creando certificado X.509...\n");
  
  // Crear certificado
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  
  // Valididad: 1 año
  const now = new Date();
  cert.validity.notBefore = now;
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(now.getFullYear() + 1);
  
  // Atributos del sujeto
  const attrs = [
    { name: "commonName", value: "localhost" },
    { name: "countryName", value: "AR" },
    { name: "stateOrProvinceName", value: "Buenos Aires" },
    { name: "localityName", value: "Buenos Aires" },
    { name: "organizationName", value: "KeyPass Auth" },
  ];
  
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // Auto-firmado: issuer = subject
  
  // Extensiones
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    {
      name: "keyUsage",
      keyCertSign: true,
      digitalSignature: true,
      nonRepudiation: true,
      keyEncipherment: true,
      dataEncipherment: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
      clientAuth: true,
    },
    {
      name: "subjectAltName",
      altNames: [
        { type: 2, value: "localhost" }, // DNS
        { type: 7, ip: "127.0.0.1" }, // IPv4
        { type: 7, ip: "192.168.0.8" }, // IPv4 red local
      ],
    },
  ]);
  
  // Firmar el certificado con la clave privada
  cert.sign(keys.privateKey, forge.md.sha256.create());
  
  // Convertir a PEM
  const pemKey = forge.pki.privateKeyToPem(keys.privateKey);
  const pemCert = forge.pki.certificateToPem(cert);
  
  return {
    key: pemKey,
    cert: pemCert,
  };
}

/**
 * Función principal
 */
function main(): void {
  console.log("\n" + "═".repeat(70));
  console.log("🔐 GENERADOR DE CERTIFICADOS TLS - KEYPASS AUTH");
  console.log("═".repeat(70) + "\n");

  // Crear directorio de certificados
  if (!existsSync(CERTS_DIR)) {
    mkdirSync(CERTS_DIR);
    console.log(`📁 Directorio creado: ${CERTS_DIR}\n`);
  }

  const keyPath = join(CERTS_DIR, "key.pem");
  const certPath = join(CERTS_DIR, "cert.pem");

  console.log("🔑 Generando clave privada y certificado...\n");

  try {
    const { key, cert } = generateSelfSignedCert();

    // Guardar archivos
    writeFileSync(keyPath, key);
    writeFileSync(certPath, cert);

    console.log("\n" + "═".repeat(70));
    console.log("✅ CERTIFICADOS GENERADOS EXITOSAMENTE");
    console.log("═".repeat(70) + "\n");

    console.log("📄 Archivos generados:");
    console.log(`   • Clave privada: ${keyPath}`);
    console.log(`   • Certificado: ${certPath}\n`);

    console.log("🚀 Para usar HTTPS:");
    console.log("   npm run dev:https\n");

    console.log("⚠️  IMPORTANTE:");
    console.log("   • Estos certificados son AUTO-FIRMADOS (solo para desarrollo)");
    console.log("   • El navegador mostrará una advertencia de seguridad");
    console.log("   • Para producción, usá certificados de Let's Encrypt");
    console.log("   • Agregá las IPs de tu red al certificado si es necesario\n");

    console.log("🔧 Para agregar más IPs/dominios al certificado:");
    console.log("   Editá el parámetro subjectAltName en este script\n");

    console.log("═".repeat(70) + "\n");
  } catch (error) {
    console.error("\n❌ Error generando certificados:", error);
    process.exit(1);
  }
}

// Ejecutar
main();
