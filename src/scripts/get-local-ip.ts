/**
 * SCRIPT PARA TESTING CON DISPOSITIVOS REALES
 * 
 * Este script obtiene la IP local de la máquina y muestra instrucciones
 * para probar KeyPass Auth con dispositivos reales en la misma red.
 * 
 * Uso: npx tsx src/scripts/get-local-ip.ts
 */

import { networkInterfaces } from "node:os";

/**
 * Obtiene todas las IPs locales de la máquina
 */
function getLocalIPs(): { name: string; address: string; family: string }[] {
  const nets = networkInterfaces();
  const results: { name: string; address: string; family: string }[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      // Solo IPv4 y interfaces no internas
      if (net.family === "IPv4" && !net.internal) {
        results.push({
          name,
          address: net.address,
          family: net.family,
        });
      }
    }
  }

  return results;
}

/**
 * Muestra instrucciones de testing
 */
function showInstructions(ips: { name: string; address: string; family: string }[]): void {
  console.log("\n" + "═".repeat(70));
  console.log("📱 TESTING CON DISPOSITIVOS REALES - KEYPASS AUTH");
  console.log("═".repeat(70) + "\n");

  if (ips.length === 0) {
    console.log("❌ No se encontraron interfaces de red activas");
    console.log("   Verificá que estés conectado a una red WiFi o Ethernet\n");
    return;
  }

  console.log("🌐 IPs locales detectadas:\n");
  ips.forEach((ip, i) => {
    console.log(`   ${i + 1}. ${ip.name}: ${ip.address} (${ip.family})`);
  });

  const primaryIP = ips[0].address;
  const PORT = process.env.PORT || 3000;

  console.log("\n" + "─".repeat(70));
  console.log("📋 INSTRUCCIONES DE TESTING");
  console.log("─".repeat(70) + "\n");

  console.log("1️⃣  Asegurate de que ambos dispositivos estén en la MISMA RED WiFi\n");

  console.log("2️⃣  Iniciá el servidor accesible desde la red local:");
  console.log(`   npm run dev:network\n`);

  console.log("3️⃣  En la NOTEBOOK, abrí:");
  console.log(`   🌐 http://${primaryIP}:${PORT}/notebook/\n`);

  console.log("4️⃣  En el CELULAR, abrí:");
  console.log(`   🌐 http://${primaryIP}:${PORT}/mobile/\n`);

  console.log("5️⃣  Escaneá el QR que aparece en la notebook con el celular\n");

  console.log("─".repeat(70));
  console.log("⚠️  CONSIDERACIONES IMPORTANTES");
  console.log("─".repeat(70) + "\n");

  console.log("• La cámara del celular requiere HTTPS para funcionar en producción");
  console.log("• Para testing local, los navegadores permiten HTTP en redes privadas");
  console.log("• Si la cámara no funciona, probá con HTTPS (ver docs/HTTPS_SETUP.md)");
  console.log("• Asegurate de que el firewall permita conexiones al puerto " + PORT);
  console.log("• Algunos antivirus pueden bloquear conexiones de red local\n");

  console.log("─".repeat(70));
  console.log("🔧 TROUBLESHOOTING");
  console.log("─".repeat(70) + "\n");

  console.log("❌ El celular no puede conectar al servidor:");
  console.log("   → Verificá que ambos dispositivos estén en la misma red");
  console.log("   → Desactivá temporalmente el firewall/antivirus");
  console.log("   → Probá con otra IP si tenés múltiples interfaces\n");

  console.log("❌ La cámara no funciona en el celular:");
  console.log("   → Asegurate de haber dado permisos de cámara al navegador");
  console.log("   → Probá con HTTPS (ver docs/HTTPS_SETUP.md)");
  console.log("   → Usá Chrome o Safari (mejor soporte WebRTC)\n");

  console.log("❌ El QR no se escanea:");
  console.log("   → Aumentá el brillo de la pantalla de la notebook");
  console.log("   → Acerca el celular al QR (20-30 cm)");
  console.log("   → Verificá que el QR esté completo y no distorsionado\n");

  console.log("═".repeat(70) + "\n");
}

// Ejecutar
const ips = getLocalIPs();
showInstructions(ips);
