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

describe('client bundle artifact', () => {
  it('hands the factory to the harness module loader under its package id', () => {
    expect(artifact()).toContain('window.__ModuleLoader__.load({ id: "@onetest/dsh-deck-canvas", factory: (require) => {')
  })

  it('closes the factory by returning the CommonJS exports', () => {
    expect(withoutSourcemapComment(artifact()).endsWith('return module.exports; } });')).toBe(true)
  })

  it('wraps the factory body in a CommonJS module scope', () => {
    expect(artifact()).toContain('var module = { exports: {} };')
  })
})
