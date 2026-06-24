#!/usr/bin/env node
// Screenshot every slide of a running Octodeck dev deck for the visual-QA loop.
// Captures slide-by-slide (optionally across themes/modes) into an output dir,
// so you — or a fresh-eyes subagent — can hunt for layout bugs (see qa.md).
//
// Usage:
//   node capture_slides.mjs --url http://localhost:9001/starbucks.html \
//        --count 10 --out /tmp/shots [--themes midnight,primer] [--mode dark]
//
// Requires the project's `playwright` dependency and a browser:
//   npx playwright install chromium
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}

const url = arg('url')
const count = parseInt(arg('count', '0'), 10)
const out = arg('out', './shots')
const themes = (arg('themes', '') || '').split(',').filter(Boolean)
const mode = arg('mode', '')

if (!url || !count) {
  console.error('usage: --url <deckUrl> --count <N> --out <dir> [--themes a,b] [--mode light|dark]')
  process.exit(1)
}

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
await mkdir(resolve(out), { recursive: true })

const variants = themes.length ? themes : [null]
for (const theme of variants) {
  for (let n = 1; n <= count; n++) {
    const q = new URLSearchParams()
    if (theme) q.set('theme', theme)
    if (mode) q.set('mode', mode)
    q.set('_', String(n)) // cache-bust → full reload so each slide shows its base state
    const target = `${url}?${q.toString()}#/${n}`
    await page.goto(target, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500) // let fonts settle + transition finish
    const tag = theme ? `${theme}-` : ''
    const file = resolve(out, `${tag}slide-${String(n).padStart(2, '0')}.png`)
    await page.screenshot({ path: file })
    console.log('✓', file)
  }
}

await browser.close()
console.log(`\nDone. Inspect ${out}/ with fresh eyes (a subagent) against the checklist in references/qa.md.`)
