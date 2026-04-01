import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/byma': {
        target: 'https://open.bymadata.com.ar/vanoms-be-core/rest/api/bymadata/free',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/byma/, '')
      }
    }
  }
})
