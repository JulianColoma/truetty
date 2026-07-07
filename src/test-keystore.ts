/**
 * PRUEBA DE KEYSTORE - Almacenamiento Seguro de Claves
 * 
 * Este script demuestra el uso del KeyStore abstracto
 * y prueba la implementación WebKeyStore (localStorage).
 */

import { createKeyStore, WebKeyStore } from "./shared/keystore.js";

// ═══════════════════════════════════════════════════════════════════════════
// SIMULACIÓN DE LOCALSTORAGE PARA NODE.JS
// ═══════════════════════════════════════════════════════════════════════════

// Simular localStorage en Node.js (solo para testing)
const storage = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string): string | null => storage.get(key) || null,
  setItem: (key: string, value: string): void => {
    storage.set(key, value);
  },
  removeItem: (key: string): void => {
    storage.delete(key);
  },
  clear: (): void => {
    storage.clear();
  },
  get length(): number {
    return storage.size;
  },
  key: (index: number): string | null => {
    const keys = Array.from(storage.keys());
    return keys[index] || null;
  },
};

// Asignar localStorage global
(global as any).localStorage = localStorageMock;

// ═══════════════════════════════════════════════════════════════════════════
// PRUEBAS
// ═══════════════════════════════════════════════════════════════════════════

async function testKeyStore(): Promise<void> {
  console.log("\n" + "▓".repeat(70));
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  🧪 PRUEBA DE KEYSTORE - KEYPASS AUTH".padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓".repeat(70));

  try {
    // Crear instancia de KeyStore
    console.log("\n🔑 [TEST] Creando instancia de KeyStore...");
    const keyStore = new WebKeyStore(); // Usar directamente WebKeyStore para testing
    
    console.log(`   Plataforma: ${keyStore.getPlataforma()}`);
    console.log(`   ¿Es seguro? ${keyStore.esSeguro() ? "Sí" : "No (solo demo)"}`);

    // Test 1: Generar clave
    console.log("\n" + "═".repeat(70));
    console.log("TEST 1: Generar clave maestra");
    console.log("═".repeat(70));

    const resultadoGenerar = await keyStore.generarClave(
      "master-key-test",
      "ECDSA",
      "P-256",
      "master-key"
    );

    if (resultadoGenerar.exito) {
      console.log("✅ Clave generada exitosamente");
      console.log("   ID:", resultadoGenerar.data!.id);
      console.log("   Algoritmo:", resultadoGenerar.data!.algoritmo);
      console.log("   Curva:", resultadoGenerar.data!.curva);
      console.log("   Propósito:", resultadoGenerar.data!.proposito);
      console.log("   Plataforma:", resultadoGenerar.data!.plataforma);
      console.log("   Creado:", new Date(resultadoGenerar.data!.creado_en).toISOString());
    } else {
      console.log("❌ Error generando clave:", resultadoGenerar.error);
      process.exit(1);
    }

    // Test 2: Verificar que la clave existe
    console.log("\n" + "═".repeat(70));
    console.log("TEST 2: Verificar existencia de clave");
    console.log("═".repeat(70));

    const existe = await keyStore.existeClave("master-key-test");
    console.log(`¿Existe la clave? ${existe ? "Sí ✅" : "No ❌"}`);

    if (!existe) {
      console.log("❌ La clave no existe");
      process.exit(1);
    }

    // Test 3: Obtener clave pública
    console.log("\n" + "═".repeat(70));
    console.log("TEST 3: Obtener clave pública");
    console.log("═".repeat(70));

    const resultadoPublica = await keyStore.obtenerClavePublica("master-key-test");

    if (resultadoPublica.exito) {
      console.log("✅ Clave pública obtenida");
      console.log("   kty:", resultadoPublica.data!.kty);
      console.log("   crv:", resultadoPublica.data!.crv);
      console.log("   x:", resultadoPublica.data!.x?.substring(0, 20) + "...");
      console.log("   y:", resultadoPublica.data!.y?.substring(0, 20) + "...");
    } else {
      console.log("❌ Error obteniendo clave pública:", resultadoPublica.error);
      process.exit(1);
    }

    // Test 4: Firmar datos
    console.log("\n" + "═".repeat(70));
    console.log("TEST 4: Firmar datos");
    console.log("═".repeat(70));

    const datos = new TextEncoder().encode("Mensaje de prueba para firmar");
    const resultadoFirma = await keyStore.firmar(
      "master-key-test",
      datos.buffer,
      { name: "ECDSA", hash: "SHA-256" }
    );

    if (resultadoFirma.exito) {
      const firmaHex = Array.from(new Uint8Array(resultadoFirma.data!))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      
      console.log("✅ Datos firmados exitosamente");
      console.log("   Tamaño firma:", resultadoFirma.data!.byteLength, "bytes");
      console.log("   Firma (hex):", firmaHex.substring(0, 40) + "...");
    } else {
      console.log("❌ Error firmando:", resultadoFirma.error);
      process.exit(1);
    }

    // Test 5: Generar segunda clave
    console.log("\n" + "═".repeat(70));
    console.log("TEST 5: Generar segunda clave");
    console.log("═".repeat(70));

    const resultadoGenerar2 = await keyStore.generarClave(
      "signing-key-test",
      "ECDSA",
      "P-256",
      "signing-key"
    );

    if (resultadoGenerar2.exito) {
      console.log("✅ Segunda clave generada");
      console.log("   ID:", resultadoGenerar2.data!.id);
    } else {
      console.log("❌ Error generando segunda clave:", resultadoGenerar2.error);
      process.exit(1);
    }

    // Test 6: Listar todas las claves
    console.log("\n" + "═".repeat(70));
    console.log("TEST 6: Listar todas las claves");
    console.log("═".repeat(70));

    const resultadoListar = await keyStore.listarClaves();

    if (resultadoListar.exito) {
      console.log(`✅ Total de claves: ${resultadoListar.data!.length}`);
      resultadoListar.data!.forEach((clave, i) => {
        console.log(`\n   ${i + 1}. ${clave.id}`);
        console.log(`      Algoritmo: ${clave.algoritmo} ${clave.curva}`);
        console.log(`      Propósito: ${clave.proposito}`);
        console.log(`      Creado: ${new Date(clave.creado_en).toISOString()}`);
      });
    } else {
      console.log("❌ Error listando claves:", resultadoListar.error);
      process.exit(1);
    }

    // Test 7: Eliminar una clave
    console.log("\n" + "═".repeat(70));
    console.log("TEST 7: Eliminar clave");
    console.log("═".repeat(70));

    const resultadoEliminar = await keyStore.eliminarClave("signing-key-test");

    if (resultadoEliminar.exito) {
      console.log("✅ Clave eliminada exitosamente");
    } else {
      console.log("❌ Error eliminando clave:", resultadoEliminar.error);
      process.exit(1);
    }

    // Test 8: Verificar que la clave fue eliminada
    console.log("\n" + "═".repeat(70));
    console.log("TEST 8: Verificar eliminación");
    console.log("═".repeat(70));

    const existeDespues = await keyStore.existeClave("signing-key-test");
    console.log(`¿Existe la clave eliminada? ${existeDespues ? "Sí ❌" : "No ✅"}`);

    if (existeDespues) {
      console.log("❌ La clave todavía existe");
      process.exit(1);
    }

    // Test 9: Listar claves después de eliminar
    console.log("\n" + "═".repeat(70));
    console.log("TEST 9: Listar claves después de eliminar");
    console.log("═".repeat(70));

    const resultadoListar2 = await keyStore.listarClaves();

    if (resultadoListar2.exito) {
      console.log(`✅ Total de claves: ${resultadoListar2.data!.length}`);
      resultadoListar2.data!.forEach((clave, i) => {
        console.log(`   ${i + 1}. ${clave.id}`);
      });
    } else {
      console.log("❌ Error listando claves:", resultadoListar2.error);
      process.exit(1);
    }

    // Resumen final
    console.log("\n" + "▓".repeat(70));
    console.log("▓" + " ".repeat(68) + "▓");
    console.log("▓" + "  ✅ TODAS LAS PRUEBAS PASARON".padEnd(68) + "▓");
    console.log("▓" + " ".repeat(68) + "▓");
    console.log("▓".repeat(70));

    console.log("\n📊 RESUMEN:");
    console.log("   ✅ Generación de claves");
    console.log("   ✅ Verificación de existencia");
    console.log("   ✅ Obtención de clave pública");
    console.log("   ✅ Firma de datos");
    console.log("   ✅ Listado de claves");
    console.log("   ✅ Eliminación de claves");

    console.log("\n⚠️  ADVERTENCIA:");
    console.log("   Esta implementación usa localStorage y NO es segura para producción.");
    console.log("   Para producción, usar Secure Enclave (iOS) o Keystore (Android).");
    console.log("   Ver docs/KEYSTORE_GUIDE.md para más información.\n");

    process.exit(0);
  } catch (error) {
    console.error("\n❌ ERROR EN LA PRUEBA:", error);
    process.exit(1);
  }
}

// Ejecutar pruebas
testKeyStore();
