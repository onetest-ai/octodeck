// Export an Octodeck deck to a PDF — one slide per page, exact 16:9 (1280×720).
// Renders each slide at high DPI in the browser, then assembles a multi-page PDF.
//   npm run dev                                   # serve the deck at :9001
//   npm run build:pdf -- [themeId] --deck <name>     # → dist-pdf/<deck>-<theme>.pdf
//   (themeId default octo-glass; --deck required; DECK_BASE overrides the host)
import { chromium } from 'playwright'
import { mkdirSync } from 'fs'

const args = process.argv.slice(2)
const flagVal = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const deck = flagVal('--deck')
if (!deck) { console.error('✗ --deck <name> is required (scaffold one with: npm run new:deck -- <name>)'); process.exit(1) }
const themeId = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--deck') ?? 'octo-glass'
const base = process.env.DECK_BASE ?? 'http://localhost:9001'
const deckUrl = `${base}/${deck}.html`
const W = 1280, H = 720

const ok = await fetch(deckUrl).then((r) => r.ok).catch(() => false)
if (!ok) {
  console.error(`✗ deck not reachable at ${deckUrl}\n  PDF export renders the live deck. Start it first:\n    npm run dev\n  (check --deck <name> matches a <name>.html)`)
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })

// slide count: SLIDES env, else read the deck's progress counter (".octo-counter")
let count = Number(process.env.SLIDES) || 0
if (!count) {
  await page.goto(`${deckUrl}?theme=${themeId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  count = await page.evaluate(() => {
    const m = (document.querySelector('.octo-counter')?.textContent || '').match(/\/\s*(\d+)/)
    return m ? +m[1] : 0
  }) || 10
}

// one crisp screenshot per slide (2× → 2560×1440 source pixels)
const shots: string[] = []
for (let n = 1; n <= count; n++) {
  await page.goto(`${deckUrl}?theme=${themeId}&_=${n}#/${n}`, { waitUntil: 'networkidle' })
  await page.evaluate(() => (document as any).fonts.ready)
  await page.waitForTimeout(350)
  const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } })
  shots.push(buf.toString('base64'))
  console.log(`· slide ${n}/${count}`)
}

// assemble: one full-bleed image per page, exact 16:9, no margins
const pagesHtml = shots.map((b64) => `<div class="pg"><img src="data:image/png;base64,${b64}"/></div>`).join('')
await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${W}px ${H}px; margin: 0; }
  * { margin: 0; padding: 0; }
  html, body { background: #000; }
  .pg { width: ${W}px; height: ${H}px; overflow: hidden; }
  .pg:not(:last-child) { page-break-after: always; }     /* no trailing blank page */
  .pg img { display: block; width: ${W}px; height: ${H}px; }
</style></head><body>${pagesHtml}</body></html>`, { waitUntil: 'load' })

mkdirSync('dist-pdf', { recursive: true })
const out = `dist-pdf/${deck}-${themeId}.pdf`
await page.pdf({ path: out, width: `${W}px`, height: `${H}px`, printBackground: true, pageRanges: `1-${count}` })
await browser.close()
console.log(`built ${out} · deck=${deck} · theme=${themeId} · ${count} pages (one per slide)`)
