import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { exportHtml } from '../src/export/html.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'

/**
 * A real Vite build runs here, so these are slow by design. The alternative —
 * asserting on a generated entry string — would not catch the failure this
 * producer exists to avoid: `runtime/entry.ts` loads slides through
 * `@vite-ignore` dynamic imports that Rollup does not follow, so a build over
 * it yields a page that still 404s offline. Only an actual bundle proves the
 * deck's own modules were inlined.
 */
async function scaffoldAndExport(theme: string) {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
  const spec = resolveDeck({ name: 'launch', theme }, workspace)
  await scaffoldDeck(spec)
  return (await exportHtml(spec.directory, theme, 'dark')).toString('utf8')
}

describe('exportHtml', () => {
  it('builds one self-contained file with no external script or style refs', async () => {
    const html = await scaffoldAndExport('midnight')
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html).not.toMatch(/<script[^>]+src="[.\/]/)
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="[.\/]/)
  }, 180_000)

  it('inlines the deck’s own slides rather than fetching them at view time', async () => {
    const html = await scaffoldAndExport('midnight')
    // The scaffolded deck titles its first slide after the deck name; if the
    // slides module had not been bundled, this would be absent and the file
    // would request /@dsh-deck/... at view time instead.
    expect(html).toContain('Launch')
    expect(html).not.toContain('@dsh-deck/')
  }, 180_000)

  it('renders in the theme it is asked for, not the deck’s authored one', async () => {
    // The deck is authored as midnight; exporting as radiant must produce the
    // radiant bundle, which is what makes the canvas theme switcher meaningful.
    const html = await scaffoldAndExport('radiant')
    expect(html).toContain('radiant')
  }, 180_000)
})

describe('exportHtml font inlining', () => {
  it('inlines the theme’s faces and leaves no remote font import', async () => {
    const html = await scaffoldAndExport('octo-glass')
    // A file that still @imports Google Fonts is not self-contained: opened
    // offline it silently falls back to a system face.
    expect(html).not.toContain('fonts.googleapis.com')
    expect(html).not.toContain('rsms.me')
    expect(html).not.toContain('api.fontshare.com')
    expect(html).toContain('@font-face')
    expect(html).toContain('data:font/ttf;base64,')
  }, 180_000)

  it('inlines Inter for a theme that asks for it', async () => {
    const html = await scaffoldAndExport('commit')
    expect(html).toMatch(/font-family:\s*['"]?Inter/)
    expect(html).toContain('data:font/ttf;base64,')
  }, 180_000)
})
