// Bake the full-bleed backdrop (bg + aurora/glow gradients) of each "rich" theme
// to a 1280×720 PNG, for embedding as the PPTX slide background. Build-time only;
// flat themes don't need it (they use a native solid fill).
//   npm run dev   # gallery at :9001
//   node --experimental-strip-types scripts/pptx/bake-backdrops.ts
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const URL = process.env.DECK_URL ?? 'http://localhost:9001/'
const snap = JSON.parse(readFileSync(fileURLToPath(new globalThis.URL('./themes.resolved.json', import.meta.url)), 'utf8'))
const rich = Object.keys(snap).filter((id) => /gradient/i.test(snap[id].backdrop || ''))
console.log('rich themes to bake:', rich.join(', ') || '(none)')

const outDir = fileURLToPath(new globalThis.URL('./backdrops/', import.meta.url))
mkdirSync(outDir, { recursive: true })

const b = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
const page = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 })
await page.goto(URL)
await page.waitForTimeout(500)

for (const id of rich) {
  await page.evaluate((tid) => {
    const sel = document.querySelector('.sw-select') as HTMLSelectElement | null
    if (sel) { sel.value = tid; sel.dispatchEvent(new Event('change')) }
  }, id)
  await page.waitForTimeout(450)
  // a full-bleed div painted from the theme vars (resolves against the active :root)
  await page.evaluate(() => {
    let d = document.getElementById('__bake') as HTMLDivElement | null
    if (!d) { d = document.createElement('div'); d.id = '__bake'; document.body.appendChild(d) }
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;width:1280px;height:720px;background-color:var(--octo-bg);background-image:var(--octo-backdrop);background-repeat:no-repeat;'
  })
  await page.waitForTimeout(150)
  const el = await page.$('#__bake')
  await el!.screenshot({ path: `${outDir}${id}.png` })
  await page.evaluate(() => document.getElementById('__bake')?.remove())
  console.log('baked', `${id}.png`)
}
await b.close()
