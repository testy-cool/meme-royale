import { defineConfig } from 'vite';

export default defineConfig({
  base: '/meme-royale/',
  build: { chunkSizeWarningLimit: 1000 },
});
