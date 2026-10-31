import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ppSourceBabel } from '../vite-plugin/index.js';

// Optional, dev only: tags every HTML element with data-pp-src="file:line:col" so pixelPerfect
// can point at the exact line. pixelPerfect also works without it. Nothing reaches production builds.
// The bridge runs separately: node bridge/index.js ./demo-app
export default defineConfig(({ command }) => ({
  plugins: [react({ babel: { plugins: command === 'serve' ? [ppSourceBabel] : [] } })],
  server: { port: 5173, strictPort: true }
}));