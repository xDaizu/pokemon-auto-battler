import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { imagePlugin } from './vite/imagePlugin.js';

export default defineConfig({
  plugins: [react(), imagePlugin()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
