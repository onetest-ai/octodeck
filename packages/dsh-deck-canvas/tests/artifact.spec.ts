import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const artifact = (): string => readFileSync(resolve(import.meta.dirname, '../lib/client.js'), 'utf8')

/**
 * `sourcemap: true` makes rolldown append a trailing `//# sourceMappingURL=`
 * comment after the footer in every conforming bundle (verified against the
 * harness's own committed client.js artifacts, e.g.
 * packages/client/ui-tool/lib/client.js) — so the footer check strips that
 * comment first rather than asserting an exact end-of-file suffix.
 */
const withoutSourcemapComment = (source: string): string =>
  source.replace(/\/\/# sourceMappingURL=.*\s*$/, '').trimEnd()

/**
 * Collapse whitespace before comparing banner/footer structure: tsdown's
 * rolldown codegen reformats the literal banner/footer strings onto their
 * own indented lines (verified against the harness's own committed
 * packages/client/ui-tool/lib/client.js, which reformats identically) rather
 * than preserving them as the single-line strings tsdown.config.ts supplies.
 */
const collapsedWhitespace = (source: string): string => source.replace(/\s+/g, ' ').trim()

describe('client bundle artifact', () => {
  it('hands the factory to the harness module loader under its package id', () => {
    expect(collapsedWhitespace(artifact()))
      .toContain(collapsedWhitespace('window.__ModuleLoader__.load({ id: "@onetest/dsh-deck-canvas", factory: (require) => {'))
  })

  it('closes the factory by returning the CommonJS exports', () => {
    expect(collapsedWhitespace(withoutSourcemapComment(artifact())))
      .toMatch(/return module\.exports;\s*\}\s*\}\s*\);?\s*$/)
  })

  it('wraps the factory body in a CommonJS module scope', () => {
    expect(artifact()).toContain('var module = { exports: {} };')
  })
})
