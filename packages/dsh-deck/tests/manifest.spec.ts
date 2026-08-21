import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
) as Record<string, any>

describe('bundle manifest', () => {
  it('declares the patch that makes it installable with dsh plugin add', () => {
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('publishes the patch file itself', () => {
    expect(manifest.files).toContain('cordis.patch.yml')
  })

  it('keeps cordis a peer, never a dependency', () => {
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBeDefined()
    expect(manifest.dependencies?.['@deepseek-ai/cordis']).toBeUndefined()
  })
})
