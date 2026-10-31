import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ppSourceBabel } from '../vite-plugin/index.js';

// In dev, every HTML element gets data-pp-src="file:line:col" so pixelPerfect can find its source.
export default defineConfig(({ command }) => ({
  plugins: [react({ babel: { plugins: command === 'serve' ? [ppSourceBabel] : [] } })],
  server: { port: 5173, strictPort: true }
}));
