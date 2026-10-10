// Vite empaqueta el cliente (three.js incluido). En desarrollo corre dentro de Express (server/index.js).
import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('./client', import.meta.url)),
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
};
