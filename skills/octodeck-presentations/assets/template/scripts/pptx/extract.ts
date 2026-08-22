// Pixel-tight extractor: load the real rendered deck at 1:1 (1280×720) and
// transcribe each slide's DOM to Scene IR by MEASURING it — never re-deriving
// layout. HTML boxes come from computed styles; text from per-line client rects
// (so wrapping is identical by construction); SVG is translated to native vector
// (paths→freeform curves, gradients→gradient fills, markers→arrowheads).
//   npm run dev   # the deck at :9001
//   used by build.ts
import { chromium } from 'playwright'
import { WALKER } from './walker.ts'
import { slidesFromRaw } from './ir-from-raw.ts'
import type { SlideIR, Paint } from './ir.ts'

/** Read the deck's slide count from its progress counter (".octo-counter" → "1 / N"). */
async function detectCount(page: any, deckUrl: string, themeId: string): Promise<number> {
  await page.goto(`${deckUrl}?theme=${themeId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const n = await page.evaluate(() => {
    const m = (document.querySelector('.octo-counter')?.textContent || '').match(/\/\s*(\d+)/)
    return m ? +m[1] : 0
  })
  return n || 10
}

export async function extractDeck(deckUrl: string, themeId: string, bg: Paint, count = 0): Promise<SlideIR[]> {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  if (!count) count = Number(process.env.SLIDES) || await detectCount(page, deckUrl, themeId)
  const raw: unknown[][] = []
  for (let n = 1; n <= count; n++) {
    await page.goto(`${deckUrl}?theme=${themeId}&_=${n}#/${n}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => (document as any).fonts.ready)
    await page.waitForTimeout(350)
    // Stringified with an explicit `document`: WALKER now takes the document
    // to measure, and a Document is not serializable across the Playwright
    // boundary, so it is applied inside the page instead of passed in.
    raw.push(await page.evaluate(`(${WALKER.toString()})(document)`) as unknown[])
  }
  await browser.close()
  return slidesFromRaw(raw, bg)
}

export { slidesFromRaw } from './ir-from-raw.ts'
