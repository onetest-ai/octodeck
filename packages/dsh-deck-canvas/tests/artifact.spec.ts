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

  /**
   * The canvas imports React for real (DeckCanvas.tsx/DeckToolview.tsx are
   * JSX). tsdown.config.ts's `deps.neverBundle`/`alwaysBundle` is supposed to
   * keep every baseline module-table entry — `react`, `react/jsx-runtime`
   * here; `@deepseek-ai/dsh-client-ui-slots` and
   * `@deepseek-ai/dsh-client-runtime/client` are type-only in this package's
   * own source, so their imports are erased before bundling and never
   * surface as a `require()` either way — external rather than inlined.
   * `require("react")` in the built factory is exactly what a correctly
   * externalized bundle looks like (see src/client/index.ts's `let react =
   * require("react")`, emitted by the harness's own real
   * `@deepseek-ai/dsh-client-ui-tool` artifact the same way); the prior
   * round of this suite had no assertion that would fail if externalization
   * silently stopped working, which is exactly how a full copy of React
   * got inlined here undetected (tsdown pinned below the version whose
   * `deps` option this config relies on — see the package's own history).
   */
  it('keeps baseline module-table imports external instead of inlining a copy', () => {
    const source = artifact()
    expect(source).toContain('require("react")')
    expect(source).toContain('require("react/jsx-runtime")')
    // A bundled copy of React ships its own internal module wrapper for
    // `react/cjs/react.production.min.js` (or the dev build); its absence,
    // together with the `require()` calls above, is what distinguishes an
    // external dependency from an inlined one.
    expect(source).not.toContain('react.production.min.js')
    expect(source).not.toContain('react.development.js')
  })
})
