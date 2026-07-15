import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Build lands in the wheel package so `neiro ui` can serve the SPA without Tauri.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:8377',
      '/files': 'http://127.0.0.1:8377',
    },
  },
  build: {
    outDir: '../src/neiro/ui/static',
    emptyOutDir: true,
  },
})
