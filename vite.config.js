import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  server: {
    proxy: {
      '/api/byma': {
        target: 'https://apigw.byma.com.ar',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/byma/, ''),
      },
    },
  },
});
