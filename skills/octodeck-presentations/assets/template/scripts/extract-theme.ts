/**
 * extract-theme — reverse-engineer an Octodeck theme from a live URL.
 *
 *   npm run extract-theme -- https://primer.tailwindui.com primer
 *
 * Loads the page (following an embedded preview iframe if present), sweeps the
 * rendered computed styles for the design language (colors, fonts, material),
 * captures both light and dark, and writes a DRAFT theme that fills the
 * contract — plus a screenshot and a token report for the refinement pass.
 *
 * Requires Playwright's Chromium:  npx playwright install chromium
 */
import { chromium, type Page } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function main() {
  const [url, name] = process.argv.slice(2)
  if (!url || !name) {
    console.error('usage: npm run extract-theme -- <url> <theme-name>')
    process.exit(1)
  }

  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(url, { waitUntil: 'networkidle' })

  // Tailwind Plus (and similar) wrap the real template in a preview iframe.
  const frameSrc = await page.evaluate(() => {
    const f = document.querySelector('iframe')
    return f && /tailwindui|\.app|vercel/.test(f.src) ? f.src : null
  })
  if (frameSrc) {
    console.log(`↪ following preview frame → ${frameSrc}`)
    await page.goto(frameSrc, { waitUntil: 'networkidle' })
  }

  const tokens = await sweep(page)
  const css = render(name, tokens)

  const dir = resolve(ROOT, 'src/themes', name)
  await mkdir(dir, { recursive: true })
  await writeFile(resolve(dir, 'theme.draft.css'), css)
  await writeFile(resolve(dir, 'tokens.json'), JSON.stringify(tokens, null, 2))
  await page.screenshot({ path: resolve(dir, 'reference.png'), fullPage: false })

  await browser.close()
  console.log(`✓ wrote src/themes/${name}/{theme.draft.css, tokens.json, reference.png}`)
  console.log('  Review against reference.png, pick THE accent, then rename → theme.css')
}

/** Run the same computed-style sweep in both modes (toggling the `dark` class). */
async function sweep(page: Page) {
  const read = () =>
    page.evaluate(() => {
      const cs = (el: Element) => getComputedStyle(el)
      const solid = (c: string) => !/\(0, 0, 0, 0\)|transparent/.test(c)
      const big = (r: DOMRect) => r.width > 40 && r.height > 20
      const b = cs(document.body)
      const root = cs(document.documentElement)
      let accent: string | null = null
      document.querySelectorAll('a,button').forEach((el) => {
        if (accent) return
        const s = cs(el), r = el.getBoundingClientRect()
        if (big(r) && (s.backgroundImage.includes('gradient') || solid(s.backgroundColor)))
          accent = s.backgroundImage.includes('gradient') ? s.backgroundImage : s.backgroundColor
      })
      const shadows = new Set<string>(), radii = new Set<string>(), grads = new Set<string>()
      document.querySelectorAll('*').forEach((el) => {
        const s = cs(el), r = el.getBoundingClientRect()
        if (r.width < 60 || r.height < 24) return
        if (s.boxShadow !== 'none') shadows.add(s.boxShadow)
        if (s.borderRadius !== '0px') radii.add(s.borderRadius)
        if (s.backgroundImage.includes('gradient')) grads.add(s.backgroundImage)
      })
      const h1 = document.querySelector('h1')
      return {
        bg: solid(root.backgroundColor) ? root.backgroundColor : b.backgroundColor,
        fg: b.color,
        accent,
        font: b.fontFamily.split(',')[0].replace(/"/g, ''),
        fontHeading: h1 ? cs(h1).fontFamily.split(',')[0].replace(/"/g, '') : null,
        weightHeading: h1 ? cs(h1).fontWeight : null,
        trackingHeading: h1 ? cs(h1).letterSpacing : null,
        radii: [...radii].slice(0, 8),
        shadows: [...shadows].slice(0, 4),
        gradients: [...grads].slice(0, 4),
      }
    })

  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  const light = await read()
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  const dark = await read()
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  return { light, dark }
}

function render(name: string, t: Awaited<ReturnType<typeof sweep>>): string {
  const L = t.light, D = t.dark
  return `/* ${name} — DRAFT reverse-engineered theme. Review against reference.png.
   Pick THE accent (the sweep guesses the first solid/gradient button),
   confirm dark-mode values, and decide which gradient is decorative. */
[data-theme="${name}"] {
  --octo-font: "${L.font}", system-ui, sans-serif;
  --octo-font-heading: "${L.fontHeading ?? L.font}", system-ui, sans-serif;
  --octo-weight-heading: ${L.weightHeading ?? 700};
  --octo-tracking-heading: ${L.trackingHeading === 'normal' ? '-0.01em' : L.trackingHeading};
  --octo-radius: ${L.radii[0] ?? '12px'};
  --octo-panel-shadow: ${L.shadows[0] ?? 'none'};
}
[data-theme="${name}"][data-mode="light"] {
  --octo-bg: ${L.bg};
  --octo-fg: ${L.fg};
  --octo-accent: ${L.accent ?? L.fg};
}
[data-theme="${name}"][data-mode="dark"] {
  --octo-bg: ${D.bg};
  --octo-fg: ${D.fg};
  --octo-accent: ${D.accent ?? D.fg};
}
`
}

main().catch((err) => { console.error(err); process.exit(1) })
