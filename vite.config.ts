import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  // Sem inline de assets: o AudioWorklet precisa de uma URL de arquivo (CSP não permite data:).
  build: { outDir: 'dist', target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
