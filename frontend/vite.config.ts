import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Unset in dev, so `base` stays '/' and the proxy rule below needs no edit.
  // The production build sets VITE_BASE=/battler/ (DEPLOYMENT.md §5), which is
  // what makes asset URLs and the API root resolve under the Firebase Hosting
  // path prefix — see `import.meta.env.BASE_URL` in src/api/client.ts.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  // Emitted straight into the Firebase Hosting public dir at the path `base`
  // generates, so `firebase deploy` needs no copy step.
  build: {
    outDir: '../hosting/battler',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
