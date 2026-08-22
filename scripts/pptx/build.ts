// Assemble the IR slides → OOXML parts → a packaged .pptx.
//   node scripts/pptx/build.ts [themeId] --deck <name>
//   (themeId default octo-glass; --deck required; DECK_BASE overrides the host)
// EXTRACTS the real rendered deck (pixel-tight) — needs `npm run dev`.
import { resolveTheme } from './theme.ts'
import { extractDeck } from './extract.ts'
import { buildPptx } from './ooxml.ts'
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { zipSync } from '../../packages/dsh-deck/src/export/zip.ts'

const args = process.argv.slice(2)
const flagVal = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const deck = flagVal('--deck')
if (!deck) { console.error('✗ --deck <name> is required (scaffold one with: npm run new:deck -- <name>)'); process.exit(1) }
const themeId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--deck') ?? 'octo-glass'
const base = process.env.DECK_BASE ?? 'http://localhost:9001'
const deckUrl = `${base}/${deck}.html`
const t = resolveTheme(themeId)

// extraction reads the live DOM — fail with a clear instruction if dev is down
const ok = await fetch(deckUrl).then((r) => r.ok).catch(() => false)
if (!ok) {
  console.error(`✗ deck not reachable at ${deckUrl}\n  Pixel-tight export reads the live deck. Start it first:\n    npm run dev\n  (check --deck <name> matches a <name>.html)`)
  process.exit(1)
}
const slides = await extractDeck(deckUrl, themeId, t.color.bg)
// rich themes have a baked aurora PNG (run `pptx:bake` first); load it if present.
const bakedPath = fileURLToPath(new URL(`./backdrops/${themeId}.png`, import.meta.url))
const backdrop = t.backdrop.rich && existsSync(bakedPath) ? readFileSync(bakedPath) : undefined

// embed each weight variant as its own named typeface, so glyph metrics match the
// web exactly and no renderer synthesizes a too-heavy bold. (extract.ts names the
// precise face per run, e.g. "Geist SemiBold".)
const FONT_VARIANTS: Record<string, [string, string][]> = {
  'Geist': [['Geist', 'Geist-Regular.ttf'], ['Geist Medium', 'Geist-Medium.ttf'], ['Geist SemiBold', 'Geist-SemiBold.ttf']],
  'Geist Mono': [['Geist Mono', 'GeistMono-Regular.ttf'], ['Geist Mono Medium', 'GeistMono-Medium.ttf']],
  'Switzer': [['Switzer', 'Switzer-Regular.ttf'], ['Switzer Medium', 'Switzer-Medium.ttf'], ['Switzer Semibold', 'Switzer-Semibold.ttf'], ['Switzer Bold', 'Switzer-Bold.ttf']],
}
const fontDir = fileURLToPath(new URL('./fonts/', import.meta.url))
const fonts = t.font.embed.flatMap((name) => (FONT_VARIANTS[name] ?? []).flatMap(([typeface, file]) => {
  if (!existsSync(`${fontDir}${file}`)) { console.warn(`· font not embedded (no TTF): ${typeface}`); return [] }
  return [{ typeface, regular: readFileSync(`${fontDir}${file}`) }]
}))
const files = buildPptx(slides, t, backdrop, fonts)

mkdirSync('dist-pptx', { recursive: true })
const out = `dist-pptx/${deck}-${themeId}.pptx`
// Packaged in-process by the plugin's ZIP writer: the previous path staged
// every part to dist-pptx/unpacked and shelled out to python3 to zip it, a
// dependency a distributable plugin cannot assume.
writeFileSync(out, zipSync(files as Record<string, string | Uint8Array>))
console.log(`built ${out} · deck=${deck} · theme=${themeId} · ${slides.length} slides`)
