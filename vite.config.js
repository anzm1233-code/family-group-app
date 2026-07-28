import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In production Netlify serves /api/* via netlify/functions/groups.mjs
    // directly. For plain `vite dev`, proxy the same path to the local
    // functions shim (see scripts/dev-functions-server.mjs).
    proxy: {
      '/api': 'http://localhost:9000',
    },
  },
})
