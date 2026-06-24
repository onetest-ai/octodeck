import { defineConfig } from 'vite'

// Dev server runs on 9001 (8083 is in use on this machine).
export default defineConfig({
  server: {
    port: 9001,
    strictPort: true,
    open: false,
  },
  preview: {
    port: 9001,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        // The component gallery. Deck entries (<name>.html) are added by `npm run new:deck`.
        main: 'index.html',
      },
    },
  },
})
