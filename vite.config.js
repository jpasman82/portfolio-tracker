import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Todo lo que empiece con /api/byma se redirige a apigw.byma.com.ar
      // /api/byma/oauth/token/          → https://apigw.byma.com.ar/oauth/token/
      // /api/byma/snapshot/v1/equity    → https://apigw.byma.com.ar/snapshot/v1/equity
      '/api/byma': {
        target: 'https://apigw.byma.com.ar',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/byma/, ''),
      },
    },
  },
});
