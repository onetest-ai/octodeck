import { globSync } from 'node:fs'
import { basename } from 'node:path'
import { defineConfig } from 'vite'

/**
 * Build inputs: the component gallery, plus every deck entry present.
 *
 * Deck entries are discovered rather than registered. `npm run new:deck` used
 * to add a line here, which meant scaffolding a deck edited a tracked file and
 * left the repository dirty — a personal deck cannot be committed, so that edit
 * could never be resolved either way. Globbing makes a deck purely local: it
 * builds while it exists and leaves nothing behind when it does not.
 */
function deckEntries(): Record<string, string> {
  const entries: Record<string, string> = { main: 'index.html' }
  for (const file of globSync('*.html')) {
    const name = basename(file, '.html')
    if (name !== 'index') entries[name] = file
  }
  return entries
}

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
      input: deckEntries(),
    },
  },
})
