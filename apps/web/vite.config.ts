import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001', changeOrigin: true }
    }
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Separate, long-cacheable vendor chunks (editor, React, sanitizer, icons).
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/](@tiptap|prosemirror-|orderedmap|rope-sequence|w3c-keyname|linkifyjs)/.test(id)) return 'editor';
          if (/[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react';
          if (/[\\/]dompurify[\\/]/.test(id)) return 'sanitize';
          if (/[\\/]lucide-react[\\/]/.test(id)) return 'icons';
          return 'vendor';
        }
      }
    }
  }
});
