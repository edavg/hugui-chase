import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        main: new URL('./index.html', import.meta.url).pathname,
        stalkerLab: new URL('./stalker-lab.html', import.meta.url).pathname,
      },
    },
  },
  server: {
    host: true,
  },
});
