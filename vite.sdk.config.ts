import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/sdk/keypass-sdk.ts'),
      name: 'KeyPassSDK',
      fileName: (format) => `keypass-sdk.${format === 'es' ? 'mjs' : 'js'}`,
      formats: ['es', 'umd'],
    },
    outDir: 'dist/sdk',
    sourcemap: true,
    minify: 'esbuild',
    rollupOptions: {
      external: [],
      output: {
        exports: 'named',
        globals: {
          qrcode: 'QRCode',
        },
      },
    },
  },
});
