import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `npm run dev` serves on :5173 and forwards data and images to server.py on :8000
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:8000', ws: true },
      '/resources': 'http://localhost:8000',
    },
  },
})
