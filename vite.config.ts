import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works on any GitHub Pages path (user or project site).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
