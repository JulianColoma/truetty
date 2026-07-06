/**
 * SERVIDOR PARA TESTING EN RED LOCAL
 * 
 * Inicia el servidor de KeyPass Auth accesible desde dispositivos
 * en la misma red local. Muestra las IPs disponibles y URLs de acceso.
 * 
 * Uso: npm run dev:network
 */

import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";

/**
 * Obtiene las IPs locales de la máquina
 */
function getLocalIPs(): string[] {
  const nets = networkInterfaces();
  const results: string[] = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        results.push(net.address);
      }
    }
  }

  return results;
}

/**
 * Muestra banner de inicio con instrucciones
 */
function showBanner(ips: string[], port: number): void {
  console.log("\n" + "▓".repeat(70));
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓" + "  🌐 KEYPASS AUTH - SERVIDOR DE RED LOCAL".padEnd(68) + "▓");
  console.log("▓" + " ".repeat(68) + "▓");
  console.log("▓".repeat(70) + "\n");

  console.log("📡 IPs disponibles en tu red local:\n");
  ips.forEach((ip, i) => {
    console.log(`   ${i + 1}. http://${ip}:${port}`);
  });

  console.log("\n" + "─".repeat(70));
  console.log("📱 URLs de acceso para dispositivos en la misma red:");
  console.log("─".repeat(70) + "\n");

  if (ips.length > 0) {
    const primaryIP = ips[0];
    console.log(`   📓 Notebook: http://${primaryIP}:${port}/notebook/`);
    console.log(`   📱 Celular:  http://${primaryIP}:${port}/mobile/\n`);
  }

  console.log("─".repeat(70));
  console.log("⚠️  IMPORTANTE:");
  console.log("─".repeat(70) + "\n");
  console.log("   • Ambos dispositivos deben estar en la MISMA red WiFi");
  console.log("   • El firewall debe permitir conexiones al puerto " + port);
  console.log("   • Para usar la cámara en el celular, necesitás HTTPS");
  console.log("   • Ver docs/HTTPS_SETUP.md para configuración HTTPS\n");
  console.log("─".repeat(70) + "\n");
}

// Iniciar servidor
const PORT = Number(process.env.PORT) || 3000;
const ips = getLocalIPs();

showBanner(ips, PORT);

// Iniciar el servidor principal
console.log("🚀 Iniciando servidor...\n");

const server = spawn("npx", ["tsx", "src/server/index.ts"], {
  env: { ...process.env, HOST: "0.0.0.0", PORT: String(PORT) },
  stdio: "inherit",
  shell: true,
});

server.on("error", (err) => {
  console.error("❌ Error iniciando servidor:", err);
  process.exit(1);
});

server.on("exit", (code) => {
  console.log(`\n👋 Servidor terminado con código ${code}`);
  process.exit(code || 0);
});

// Manejar señales de terminación
process.on("SIGINT", () => {
  console.log("\n\n🛑 Deteniendo servidor...");
  server.kill("SIGTERM");
});

process.on("SIGTERM", () => {
  server.kill("SIGTERM");
});
