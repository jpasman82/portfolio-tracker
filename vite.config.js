import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/byma': {
        target: 'https://open.bymadata.com.ar',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/byma/, '/vanoms-be-core/rest/api/bymadata/free'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'https://open.bymadata.com.ar');
            proxyReq.setHeader('Referer', 'https://open.bymadata.com.ar/');
          });
        }
      }
    }
  }
})
