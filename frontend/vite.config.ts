import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig({
  // Unset in dev, so `base` stays '/' and the proxy rule below needs no edit.
  // The production build sets VITE_BASE=/battler/ (docs/RELEASING.md §4), which is
  // what makes asset URLs and the API root resolve under the Firebase Hosting
  // path prefix — see `import.meta.env.BASE_URL` in src/api/client.ts.
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    // Only active when running: VITE_VISUALIZE=true vite build
    // Opens stats.html in your browser after the build finishes.
    process.env.VITE_VISUALIZE === 'true' &&
      visualizer({ open: true, gzipSize: true, brotliSize: true, filename: '.stats/stats.html' }),
    process.env.VITE_VISUALIZE === 'true' &&
      visualizer({ template: 'raw-data', gzipSize: true, brotliSize: true, filename: '.stats/stats.json' }),
  ],
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
