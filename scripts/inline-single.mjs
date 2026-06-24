// Post-processes dist-single/<deck>.html into a fully self-contained file:
// inlines the favicon and the Google-Fonts web fonts as data URIs (no network at view time).
// Run after `vite build --config vite.singlefile.config.ts` (see the build:single npm script).
import { readFileSync, writeFileSync, existsSync } from 'fs'

const DECK = process.env.DECK
if (!DECK) { console.error('✗ DECK env var required — e.g. DECK=<name> npm run build:single'); process.exit(1) }
const FILE = `dist-single/${DECK}.html`
let html = readFileSync(FILE, 'utf8')

// 1 · favicon → data URI
if (existsSync('public/favicon.svg')) {
  const uri = 'data:image/svg+xml;base64,' + Buffer.from(readFileSync('public/favicon.svg')).toString('base64')
  html = html.replace(/href="\.\/favicon\.svg"/, `href="${uri}"`)
}

// 2 · Google Fonts @import → inlined @font-face with base64 woff2
const m = html.match(/@import"(https:\/\/fonts\.googleapis\.com[^"]*)";/)
if (m) {
  try {
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
    let css = await fetch(m[1], { headers: { 'User-Agent': UA } }).then((r) => r.text())
    const urls = [...new Set([...css.matchAll(/url\((https:\/\/[^)]+\.woff2)\)/g)].map((x) => x[1]))]
    for (const u of urls) {
      const buf = Buffer.from(await fetch(u).then((r) => r.arrayBuffer()))
      css = css.split(u).join(`data:font/woff2;base64,${buf.toString('base64')}`)
    }
    html = html.replace(m[0], css)
    console.log(`inlined ${urls.length} font files`)
  } catch (e) {
    console.warn('font inline skipped (no network?) — fonts stay remote:', e.message)
  }
}

writeFileSync(FILE, html)
const ext = (html.match(/fonts\.(googleapis|gstatic)\.com|src="https?:|href="(?:https?:|\.\/)/g) || []).length
console.log(`wrote ${FILE} · ${(html.length / 1024).toFixed(0)} KB · external refs: ${ext}`)
