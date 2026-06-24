// Build-time, ONE-TIME snapshot of every Octodeck theme's resolved tokens.
// Custom props don't evaluate color-mix()/oklch() until *used*, so each token is
// read through a probe element (set a real property to var(--token), read computed).
// Output: scripts/pptx/themes.resolved.json — pure data the adapter consumes at
// runtime (no browser on the request path).
//
//   npm run dev   # gallery at :9001 registers all themes
//   node --experimental-strip-types scripts/pptx/resolve-themes.ts
import { chromium } from 'playwright'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'

const DECK_URL = process.env.DECK_URL ?? 'http://localhost:9001/'
const THEMES = ['midnight', 'protocol', 'primer', 'radiant', 'commit', 'octo-glass']

// token → the real CSS property we read it through
const COLOR = ['bg', 'fg', 'accent', 'accent-2', 'surface', 'surface-2', 'overlay',
  'fg-muted', 'fg-subtle', 'border', 'border-strong', 'on-accent', 'panel-bg',
  'code-bg', 'progress', 'counter-fg']
const SIZE = ['fs-title', 'fs-h2', 'fs-h3', 'fs-body', 'fs-note', 'radius', 'radius-lg', 'pad', 'card-pad', 'gap']
const FONT = ['font', 'font-heading', 'font-mono']

const b = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
const page = await b.newPage({ viewport: { width: 1280, height: 720 } })
await page.goto(DECK_URL)
await page.waitForTimeout(600)

const result: Record<string, unknown> = {}
for (const theme of THEMES) {
  // switch via the gallery's theme <select> (triggers setTheme → lazy-loads CSS)
  const ok = await page.evaluate(async (id) => {
    const sel = document.querySelector('.sw-select') as HTMLSelectElement | null
    if (!sel) return false
    sel.value = id
    sel.dispatchEvent(new Event('change'))
    return true
  }, theme)
  if (!ok) { console.warn('no theme switcher — only the loaded theme is available'); }
  await page.waitForTimeout(450)

  const tokens = await page.evaluate((maps) => {
    const { COLOR, SIZE, FONT } = maps
    const host = document.querySelector('.octo-slide') || document.body // inside the cqw container
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;'
    host.appendChild(probe)
    const read = (prop: string, value: string) => { probe.style.cssText = `position:absolute;left:-9999px;${prop}:${value}`; return getComputedStyle(probe)[prop as any] as string }
    const out: any = { theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.mode, color: {}, size: {}, font: {} }
    for (const t of COLOR) out.color[t] = read('background-color', `var(--octo-${t})`)
    for (const t of SIZE) out.size[t] = read('font-size', `var(--octo-${t})`) // px, eval'd at 1280 container
    for (const t of FONT) out.font[t] = read('font-family', `var(--octo-${t})`)
    out.weightHeading = read('font-weight', 'var(--octo-weight-heading)')
    out.tracking = read('letter-spacing', 'var(--octo-fs-body) var(--octo-tracking-heading)') // fallback below
    out.trackingHeading = (() => { probe.style.cssText = 'position:absolute;left:-9999px;font-size:100px;letter-spacing:var(--octo-tracking-heading)'; return getComputedStyle(probe).letterSpacing })()
    out.panelBackdrop = read('backdrop-filter', 'var(--octo-panel-backdrop)')
    out.backdrop = (() => { probe.style.cssText = 'position:absolute;left:-9999px;width:10px;height:10px;background:var(--octo-backdrop)'; return getComputedStyle(probe).backgroundImage })()
    out.panelShadow = read('box-shadow', 'var(--octo-panel-shadow)')
    probe.remove()
    return out
  }, { COLOR, SIZE, FONT })

  result[theme] = tokens
  console.log(`${theme}: bg=${tokens.color.bg} fg=${tokens.color.fg} accent=${tokens.color.accent} title=${tokens.size['fs-title']} font=${(tokens.font.font || '').split(',')[0]}`)
}

await b.close()
writeFileSync(new URL('./themes.resolved.json', import.meta.url), JSON.stringify(result, null, 1))
console.log('wrote scripts/pptx/themes.resolved.json')
