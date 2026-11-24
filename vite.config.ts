import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react(),
    // O servidor de desenvolvimento (ws://localhost:5173) só entra na política de segurança fora do build final.
    { name: 'csp-producao', apply: 'build', transformIndexHtml: (html: string) => html.replace(' ws://localhost:5173', '') },
  ],
  base: './',
  server: { port: 5173, strictPort: true },
  // Sem inline de assets: o AudioWorklet precisa de uma URL de arquivo (CSP não permite data:).
  build: { outDir: 'dist', target: 'es2022', assetsInlineLimit: 0 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
