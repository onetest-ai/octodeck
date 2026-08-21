import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

/** Call the exported runtime schema's validate the way cordis does. */
async function validate(value: unknown) {
  return Config['~standard'].validate(value)
}

describe('Config', () => {
  it('accepts a base beginning with a leading slash', async () => {
    const result = await validate({ base: '/deck' })
    expect(result.issues).toBeUndefined()
    expect('value' in result && result.value).toEqual({ base: '/deck' })
  })

  it('rejects a missing base', async () => {
    const result = await validate({})
    expect(result.issues).toBeDefined()
  })

  it('rejects a non-string base', async () => {
    const result = await validate({ base: 42 })
    expect(result.issues).toBeDefined()
  })

  it('rejects a base without a leading slash', async () => {
    const result = await validate({ base: 'deck' })
    expect(result.issues).toBeDefined()
  })

  it('rejects a non-object config', async () => {
    const result = await validate(undefined)
    expect(result.issues).toBeDefined()
  })
})
