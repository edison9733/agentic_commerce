import tailwind from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `base: './'` keeps the build relocatable, so the same files work on any
// static host or sub-path. Routing is hash-based for the same reason.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwind()],
  // The generated program client guards its dev-only error messages with
  // process.env.NODE_ENV, which a browser does not have.
  define: { 'process.env.NODE_ENV': JSON.stringify(mode) },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
}));
