import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: resolve(process.cwd(), 'src/index.ts'),
      fileName: 'index',
      formats: ['es'],
    },
    sourcemap: true,
    target: 'es2022',
  },
});
