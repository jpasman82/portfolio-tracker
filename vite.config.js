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
        rewrite: (path) => {
          const match = path.match(/endpoint=([^&]+)/);
          const endpoint = match ? match[1] : 'equities';
          return `/vanoms-be-core/rest/api/bymadata/free/${endpoint}`;
        },
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // Acá ocurre la magia: Le mentimos a BYMA diciéndole que somos ellos
            proxyReq.setHeader('Origin', 'https://open.bymadata.com.ar');
            proxyReq.setHeader('Referer', 'https://open.bymadata.com.ar/');
          });
        }
      }
    }
  }
})
