import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { THEMES } from '../src/definition.ts'
import { CANDIDATE, PROVIDER_NAME, skillProvider } from '../src/skill.ts'

/** The packaged body, read the way the provider reads it. */
async function body(): Promise<string> {
  return await readFile(new URL('../assets/octodeck-deck.md', import.meta.url), 'utf8')
}

describe('the bundled octodeck-deck skill', () => {
  it('lists one candidate under its own provider name', async () => {
    const listed = await skillProvider.list({})
    expect(skillProvider.name).toBe(PROVIDER_NAME)
    expect(listed).toEqual([CANDIDATE])
  })

  it('loads the packaged body', async () => {
    const skill = await skillProvider.get(CANDIDATE, {})
    expect(skill?.content).toBe(await body())
  })

  // reason: the registry rejects a definition whose name differs from the
  // candidate it selected, and invalidates the provider for rediscovery.
  it('loads under the name it listed', async () => {
    const skill = await skillProvider.get(CANDIDATE, {})
    expect(skill?.name).toBe(CANDIDATE.name)
  })

  // reason: the body is what the model acts on, and the registry caches no
  // definition — reading per load is what keeps an edited asset live.
  it('reads the body on every load rather than capturing it once', async () => {
    const first = await skillProvider.get(CANDIDATE, {})
    const second = await skillProvider.get(CANDIDATE, {})
    expect(second?.content).toBe(first?.content)
    expect(second).not.toBe(first)
  })

  it('points relative resources at the packaged asset directory', async () => {
    const skill = await skillProvider.get(CANDIDATE, {})
    expect(skill?.resourceBase).toEqual({
      kind: 'directory',
      path: fileURLToPath(new URL('../assets/', import.meta.url)),
    })
  })

  // reason: a user who reaches for `/octodeck-deck` and a model routing from
  // the catalog description are two different surfaces, and this skill is for
  // both.
  it('is invocable from both surfaces', () => {
    expect(CANDIDATE.invocation).toEqual({ modelInvocable: true, userInvocable: true })
  })

  it('describes itself with the tools and the path it is about', () => {
    for (const term of ['deck_create', 'deck_view', '.deck/']) {
      expect(CANDIDATE.description, term).toContain(term)
    }
  })
})

describe('the skill body', () => {
  // reason: this provider supplies the metadata and returns the file
  // verbatim, so a frontmatter block would reach the model inside
  // `<skill_content>` and state the description somewhere it could drift
  // from. Nothing strips it here.
  it('carries no frontmatter, since nothing would strip it', async () => {
    expect(await body()).not.toMatch(/^---/)
  })

  it('opens with the guidance itself', async () => {
    expect(await body()).toMatch(/^# /)
  })

  // reason: these are the rules the framework enforces, and a deck that
  // breaks them renders wrong rather than merely looking unfashionable.
  it('carries the rules the framework enforces', async () => {
    const text = await body()
    for (const rule of ['cqw', 'cqh', '--octo-', '16:9']) {
      expect(text, rule).toContain(rule)
    }
    expect(text).toMatch(/never\s+`?vw`?/i)
  })

  it('names every theme the tool accepts', async () => {
    const text = await body()
    for (const theme of THEMES) expect(text, theme).toContain(theme)
  })

  // reason: the components are the deck's vocabulary; one named here that the
  // framework does not export is an import the model cannot resolve.
  it('names only components the framework exports', async () => {
    const text = await body()
    const exported = new Set(
      [...(await readFile(new URL('../../../src/framework/components.ts', import.meta.url), 'utf8'))
        .matchAll(/^export (?:function|const) ([A-Za-z]+)/gm)].map((match) => match[1]),
    )
    expect(exported.size).toBeGreaterThan(10)
    const named = [...text.matchAll(/`([A-Z][A-Za-z]+)`/g)].map((match) => match[1])
    expect(named.length).toBeGreaterThan(10)
    expect([...new Set(named)].filter((each) => !exported.has(each))).toEqual([])
  })
})
