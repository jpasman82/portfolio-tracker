import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/mae': {
        target: 'https://api.mae.com.ar',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/mae/, '/MarketData/v1'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('Origin', 'https://api.mae.com.ar');
          });
        }
      }
    }
  }
})