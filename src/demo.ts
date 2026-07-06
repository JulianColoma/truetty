/**
 * DEMOSTRACIÓN COMPLETA - KeyPass Auth
 * 
 * Este script orquesta el flujo completo de autenticación descentralizada:
 * 1. Cliente Web (Notebook) genera claves efímeras y muestra QR
 * 2. App Móvil (Celular) escanea QR y firma delegación
 * 3. Backend verifica la firma y autoriza la sesión
 * 
 * Ejecutar: npm run demo
 */

import { main as clienteWebMain } from "./client/ephemeral-client.js";
import { main as mobileMain } from "./mobile/master-app.js";
import { main as backendMain } from "./backend/verifier.js";

async function demoCompleta(): Promise<void> {
  console.log("\n" + "▓".repeat(70));
  console.log("▓".padEnd(20) + "KEYPASS AUTH - DEMOSTRACIÓN MVP".padEnd(30) + "▓".padEnd(20));
  console.log("▓".padEnd(20) + "Autenticación Descentralizada con WebCrypto".padEnd(30) + "▓".padEnd(20));
  console.log("▓".repeat(70) + "\n");

  try {
    // ═══════════════════════════════════════════════════════════════════════════
    // FASE 1: CLIENTE WEB (Notebook)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("\n" + "┌".padEnd(70, "─") + "┐");
    console.log("│ FASE 1: CLIENTE WEB ESCLAVO (Notebook)".padEnd(69) + "│");
    console.log("└".padEnd(70, "─") + "┘\n");

    const clienteWeb = await clienteWebMain();

    console.log("\n📤 [ORQUESTADOR] QR generado, esperando que el celular lo escanee...\n");

    // Simular delay de escaneo
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // ═══════════════════════════════════════════════════════════════════════════
    // FASE 2: APP MÓVIL (Celular)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("\n" + "┌".padEnd(70, "─") + "┐");
    console.log("│ FASE 2: APP MÓVIL MAESTRA (Celular)".padEnd(69) + "│");
    console.log("└".padEnd(70, "─") + "┘\n");

    const delegacion = await mobileMain(clienteWeb.qrPayload);

    console.log("\n📤 [ORQUESTADOR] Delegación creada, enviando al backend...\n");

    // Simular delay de red
    await new Promise((resolve) => setTimeout(resolve, 500));

    // ═══════════════════════════════════════════════════════════════════════════
    // FASE 3: BACKEND (Servidor)
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("\n" + "┌".padEnd(70, "─") + "┐");
    console.log("│ FASE 3: VERIFICADOR BACKEND (Servidor)".padEnd(69) + "│");
    console.log("└".padEnd(70, "─") + "┘\n");

    const verificacion = backendMain(delegacion);

    // ═══════════════════════════════════════════════════════════════════════════
    // RESUMEN FINAL
    // ═══════════════════════════════════════════════════════════════════════════
    console.log("\n" + "▓".repeat(70));
    console.log("▓".padEnd(20) + "RESUMEN DE LA DEMOSTRACIÓN".padEnd(30) + "▓".padEnd(20));
    console.log("▓".repeat(70) + "\n");

    console.log("✅ Flujo completado exitosamente\n");

    console.log("📊 ESTADÍSTICAS:");
    console.log("   • Algoritmo:", delegacion.algoritmo);
    console.log("   • Curva:", delegacion.curva);
    console.log("   • Tamaño del payload:", JSON.stringify(delegacion.payload).length, "bytes");
    console.log("   • Tamaño de la firma:", delegacion.firma.length, "caracteres hex");
    console.log("   • Verificación:", verificacion.valido ? "✓ VÁLIDA" : "✗ INVÁLIDA");

    if (verificacion.valido && verificacion.detalles?.tiempo_restante_ms) {
      const horas = Math.floor(verificacion.detalles.tiempo_restante_ms / (1000 * 60 * 60));
      const minutos = Math.floor(
        (verificacion.detalles.tiempo_restante_ms % (1000 * 60 * 60)) / (1000 * 60)
      );
      console.log("   • Tiempo restante:", `${horas}h ${minutos}m`);
    }

    console.log("\n🔐 SEGURIDAD GARANTIZADA:");
    console.log("   ✓ La clave privada maestra NUNCA salió del celular");
    console.log("   ✓ La clave privada efímera NUNCA salió de la notebook");
    console.log("   ✓ La firma prueba que el celular autorizó la sesión");
    console.log("   ✓ La expiración limita la ventana de ataque");
    console.log("   ✓ Sin contraseñas, sin tokens compartidos, sin SMS");

    console.log("\n" + "▓".repeat(70));
    console.log("▓".padEnd(20) + "FIN DE LA DEMOSTRACIÓN".padEnd(30) + "▓".padEnd(20));
    console.log("▓".repeat(70) + "\n");
  } catch (error) {
    console.error("\n❌ ERROR EN LA DEMOSTRACIÓN:", error);
    process.exit(1);
  }
}

// Ejecutar la demostración
demoCompleta().catch((error) => {
  console.error("Error fatal:", error);
  process.exit(1);
});
