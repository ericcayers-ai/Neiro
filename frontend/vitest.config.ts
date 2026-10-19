import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Frontend test runner. Vitest reuses the Vite pipeline, so TSX and the CSS/worklet
// asset imports resolve exactly as they do in the app build.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.tsx'],
    reporters: 'default',
  },
})
