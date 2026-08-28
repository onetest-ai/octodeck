import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANDIDATE } from '../src/skill.ts'
import {
  SOURCE_PACKAGE,
  installSkill,
  installedSkillPath,
  isOlder,
  readStamp,
  renderInstalledSkill,
} from '../src/skill-install.ts'

/** A throwaway harness home. */
async function home(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'dsh-home-'))
}

/**
 * Put a file where the installer looks.
 * @param dshHome - the harness home.
 * @param contents - the file to place.
 */
async function place(dshHome: string, contents: string): Promise<void> {
  const path = installedSkillPath(dshHome)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, contents, 'utf8')
}

/**
 * A file stamped as this package's, at one version.
 * @param version - the version to stamp.
 * @returns the file contents.
 */
function ours(version: string): string {
  return renderInstalledSkill('# Old body\n', version)
}

describe('isOlder', () => {
  it('orders by number, position by position', () => {
    expect(isOlder('0.2.2', '0.3.0')).toBe(true)
    expect(isOlder('0.3.0', '0.2.2')).toBe(false)
    expect(isOlder('0.9.0', '0.10.0')).toBe(true)
    expect(isOlder('1.0.0', '1.0.0')).toBe(false)
  })

  it('treats a missing position as zero', () => {
    expect(isOlder('0.3', '0.3.1')).toBe(true)
    expect(isOlder('0.3.0', '0.3')).toBe(false)
  })

  // reason: this package's own versions are pre-releases, so the ordering
  // that decides whether to replace a copy has to cover them.
  it('puts a pre-release before the release it qualifies', () => {
    expect(isOlder('0.3.0-rc.1', '0.3.0')).toBe(true)
    expect(isOlder('0.3.0', '0.3.0-rc.1')).toBe(false)
    expect(isOlder('0.3.0-rc.1', '0.3.0-rc.2')).toBe(true)
  })

  // reason: a copy whose version cannot be read would otherwise shadow every
  // later one forever.
  it('treats an unreadable or absent version as older', () => {
    expect(isOlder(undefined, '0.3.0')).toBe(true)
    expect(isOlder('not-a-version', '0.3.0')).toBe(true)
  })
})

describe('readStamp', () => {
  it('reads the source and version out of frontmatter', () => {
    expect(readStamp(ours('0.2.2'))).toEqual({ source: SOURCE_PACKAGE, version: '0.2.2' })
  })

  it('finds nothing in a file with no frontmatter', () => {
    expect(readStamp('# Just a skill\n')).toEqual({})
  })

  it('finds nothing in frontmatter that stamps nothing', () => {
    expect(readStamp('---\nname: octodeck-deck\n---\n# Body\n')).toEqual({ source: undefined, version: undefined })
  })
})

describe('renderInstalledSkill', () => {
  it('writes frontmatter the filesystem provider can parse, then the body', () => {
    const text = renderInstalledSkill('# Building a deck\n', '0.3.0')
    expect(text.startsWith('---\n')).toBe(true)
    expect(text).toContain(`name: ${CANDIDATE.name}`)
    expect(text).toContain(`version: "0.3.0"`)
    expect(text).toContain('# Building a deck')
  })

  // reason: the description contains commas, colons, and slashes; an unquoted
  // scalar with a colon in it is a YAML mapping, not a string.
  it('quotes the description so a colon in it cannot break the file', () => {
    const text = renderInstalledSkill('# Body\n', '0.3.0')
    const line = text.split('\n').find((each) => each.startsWith('description:')) ?? ''
    expect(line).toBe(`description: ${JSON.stringify(CANDIDATE.description)}`)
    expect(JSON.parse(line.slice('description: '.length))).toBe(CANDIDATE.description)
  })

  it('carries the packaged body exactly', () => {
    expect(renderInstalledSkill('# Body\n\nprose\n', '0.3.0')).toContain('# Body\n\nprose\n')
  })
})

describe('installSkill', () => {
  it('installs when nothing is there', async () => {
    const dshHome = await home()
    expect(await installSkill('0.3.0', dshHome)).toEqual({ action: 'installed' })
    const written = await readFile(installedSkillPath(dshHome), 'utf8')
    expect(readStamp(written)).toEqual({ source: SOURCE_PACKAGE, version: '0.3.0' })
    expect(written).toContain('Building a deck with Octodeck')
  })

  it('replaces an older copy it wrote', async () => {
    const dshHome = await home()
    await place(dshHome, ours('0.2.2'))
    expect(await installSkill('0.3.0', dshHome)).toEqual({ action: 'updated', from: '0.2.2' })
    expect(readStamp(await readFile(installedSkillPath(dshHome), 'utf8')).version).toBe('0.3.0')
  })

  it('leaves a copy that is already current', async () => {
    const dshHome = await home()
    await place(dshHome, ours('0.3.0'))
    expect(await installSkill('0.3.0', dshHome)).toEqual({ action: 'current' })
    expect(await readFile(installedSkillPath(dshHome), 'utf8')).toBe(ours('0.3.0'))
  })

  it('leaves a copy newer than what is shipping', async () => {
    const dshHome = await home()
    await place(dshHome, ours('0.4.0'))
    expect(await installSkill('0.3.0', dshHome)).toEqual({ action: 'current' })
  })

  // reason: a skill of this name someone authored outranks a shipped one by
  // intent, and overwriting it would lose their work without saying so.
  it('never overwrites a file it did not write', async () => {
    const dshHome = await home()
    const theirs = '---\nname: octodeck-deck\ndescription: mine\n---\n# My own version\n'
    await place(dshHome, theirs)
    expect(await installSkill('0.3.0', dshHome)).toEqual({ action: 'kept-foreign' })
    expect(await readFile(installedSkillPath(dshHome), 'utf8')).toBe(theirs)
  })

  it('leaves an unstamped copy of its own name alone', async () => {
    const dshHome = await home()
    await place(dshHome, '# No frontmatter at all\n')
    expect(await installSkill('0.3.0', dshHome)).toEqual({ action: 'kept-foreign' })
  })

  // reason: the bundled provider serves the skill either way, so a home that
  // cannot be written is not a reason to fail the plugin's mount.
  it('reports a write it could not make rather than throwing', async () => {
    const dshHome = await home()
    // A file where the skills directory belongs, so every path below it is
    // unusable rather than merely absent.
    await writeFile(join(dshHome, 'skills'), 'not a directory', 'utf8')
    const outcome = await installSkill('0.3.0', dshHome)
    expect(outcome.action).toBe('failed')
    expect(outcome.action === 'failed' && outcome.reason).toBeTruthy()
  })
})
