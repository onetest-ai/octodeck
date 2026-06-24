import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Builds a deck into ONE self-contained HTML (all JS + CSS inlined) → dist-single/<deck>.html.
// Pick the deck with the DECK env var (required):
//   DECK=<name> npx vite build --config vite.singlefile.config.ts   (then scripts/inline-single.mjs)
const DECK = process.env.DECK
if (!DECK) throw new Error('DECK env var required — e.g. DECK=<name> npm run build:single (scaffold with npm run new:deck)')
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist-single',
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: `${DECK}.html`,
    },
  },
})
