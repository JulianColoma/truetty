import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "src/frontend"),
  build: {
    outDir: resolve(__dirname, "dist/frontend"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        notebook: resolve(__dirname, "src/frontend/notebook/index.html"),
        mobile: resolve(__dirname, "src/frontend/mobile/index.html"),
        admin: resolve(__dirname, "src/frontend/admin/index.html"),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:3000",
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
});
