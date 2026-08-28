/**
 * Install this package's skill into the harness's own skills directory.
 *
 * The bundled provider in `./skill.ts` already reaches every session, so this
 * is not what makes the skill available. It is what makes it *visible*: a file
 * under `$DSH_HOME/skills` is one the user can read, edit, and override, the
 * way the agent preset this package used to ship was a directory they could
 * open.
 *
 * The copy is stamped with this package's name and version, which is what lets
 * a later version replace it without touching a copy someone edited.
 *
 * @module @onetest/dsh-deck/skill-install
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { CANDIDATE, SKILL_BODY_URL } from './skill.ts'

/**
 * This package's own version, read from its manifest.
 *
 * From the manifest rather than a constant in source: a constant is a second
 * place to bump at release, and the one that would be forgotten — leaving
 * every installed copy stamped with a version that shipped long ago and never
 * replaced.
 * @returns the version, or `0.0.0` when the manifest cannot be read.
 */
export async function packageVersion(): Promise<string> {
  try {
    const manifest = await readFile(new URL('../package.json', import.meta.url), 'utf8')
    const version = (JSON.parse(manifest) as { version?: unknown }).version
    return typeof version === 'string' ? version : '0.0.0'
  } catch {
    // An unreadable manifest means every installed copy looks newer, so
    // nothing is overwritten — which is the safe direction to fail in.
    return '0.0.0'
  }
}

/** The package that owns an installed copy; a copy without this is not ours. */
export const SOURCE_PACKAGE = '@onetest/dsh-deck'

/** What an inspection of the installed copy concluded. */
export type InstallOutcome =
  /** No copy was there. */
  | { readonly action: 'installed' }
  /** Ours, and older than the version now shipping. */
  | { readonly action: 'updated'; readonly from: string }
  /** Ours, and already this version or newer. */
  | { readonly action: 'current' }
  /** Present but not ours: someone else's file under the same name. */
  | { readonly action: 'kept-foreign' }
  /** The copy could not be written; the bundled provider still serves the skill. */
  | { readonly action: 'failed'; readonly reason: string }

/**
 * Where the installed copy lives.
 *
 * A bundle directory rather than a flat file so a later version can place
 * resources beside the body without moving what is already installed.
 * @param dshHome - the resolved harness home.
 * @returns the absolute `SKILL.md` path.
 */
export function installedSkillPath(dshHome: string): string {
  return join(dshHome, 'skills', CANDIDATE.name, 'SKILL.md')
}

/**
 * Render the installed file: frontmatter the filesystem provider parses, then
 * the packaged body.
 *
 * The body ships without frontmatter because the bundled provider returns it
 * verbatim; the filesystem provider needs metadata and strips it. One body,
 * two envelopes, rather than two bodies to keep in step.
 * @param body - the packaged skill body.
 * @param version - the version to stamp the copy with.
 * @returns the file's complete contents.
 */
export function renderInstalledSkill(body: string, version: string): string {
  // JSON is valid YAML for scalars, which is what keeps a description
  // containing colons, quotes, or a newline from producing a file the parser
  // rejects.
  return [
    '---',
    `name: ${CANDIDATE.name}`,
    `description: ${JSON.stringify(CANDIDATE.description)}`,
    'metadata:',
    `  source: ${JSON.stringify(SOURCE_PACKAGE)}`,
    `  version: ${JSON.stringify(version)}`,
    '---',
    '',
    body.trimStart(),
  ].join('\n')
}

/** What a previously installed copy declares about itself. */
export interface InstalledStamp {
  /** The package that wrote it, when it says. */
  readonly source?: string
  /** The version it was written from, when it says. */
  readonly version?: string
}

/**
 * Read the ownership stamp out of an installed copy.
 *
 * Deliberately a narrow scan of the frontmatter block rather than a YAML
 * parse: two scalars decide whether the file may be replaced, and a parser
 * would be a dependency plus a failure mode for a file this only ever
 * overwrites or leaves alone.
 * @param text - the installed file's contents.
 * @returns what it declares; empty when it declares nothing.
 */
export function readStamp(text: string): InstalledStamp {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (frontmatter === null) return {}
  const scalar = (key: string): string | undefined => {
    const found = new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm').exec(frontmatter[1])
    return found === null ? undefined : found[1].replace(/^["']|["']$/g, '')
  }
  return { source: scalar('source'), version: scalar('version') }
}

/**
 * Whether `installed` precedes `shipping`.
 *
 * Numeric dot-separated comparison, with any pre-release suffix ordering
 * before the release it qualifies. An unreadable version counts as older, so
 * a copy this package cannot make sense of is replaced rather than left to
 * shadow the shipping one forever.
 * @param installed - the version stamped on the installed copy.
 * @param shipping - the version now shipping.
 * @returns true when the installed copy should be replaced.
 */
export function isOlder(installed: string | undefined, shipping: string): boolean {
  if (installed === undefined) return true
  if (installed === shipping) return false
  const parts = (value: string): { numbers: number[]; pre: string } => {
    const [core = '', ...rest] = value.split('-')
    return { numbers: core.split('.').map((each) => Number.parseInt(each, 10)), pre: rest.join('-') }
  }
  const left = parts(installed)
  const right = parts(shipping)
  if (left.numbers.some(Number.isNaN) || right.numbers.some(Number.isNaN)) return true
  const width = Math.max(left.numbers.length, right.numbers.length)
  for (let index = 0; index < width; index += 1) {
    const one = left.numbers[index] ?? 0
    const other = right.numbers[index] ?? 0
    if (one !== other) return one < other
  }
  // Same numbers: a pre-release precedes the release, and two pre-releases
  // order lexically, which is what `rc.1` before `rc.2` needs.
  if (left.pre === right.pre) return false
  if (left.pre !== '' && right.pre === '') return true
  if (left.pre === '' && right.pre !== '') return false
  return left.pre < right.pre
}

/**
 * Put this package's skill in the harness's skills directory, or leave what is
 * already there.
 *
 * Installs when absent, replaces an older copy this package wrote, and never
 * touches a file it did not write — a skill of the same name someone authored
 * themselves outranks a shipped one by intent, and silently overwriting it
 * would lose work.
 * @param version - this package's version, stamped on the copy.
 * @param dshHome - the harness home; resolved from the environment when omitted.
 * @returns what was done, including why nothing was.
 */
export async function installSkill(version: string, dshHome = resolveDshHome()): Promise<InstallOutcome> {
  const path = installedSkillPath(dshHome)
  let existing: string | undefined
  try {
    existing = await readFile(path, 'utf8')
  } catch (cause) {
    // Anything but "not there" is a real problem — an unreadable file is not
    // one to overwrite blind.
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { action: 'failed', reason: (cause as Error).message }
    }
  }
  const stamp = existing === undefined ? undefined : readStamp(existing)
  if (stamp !== undefined && stamp.source !== SOURCE_PACKAGE) return { action: 'kept-foreign' }
  if (stamp !== undefined && !isOlder(stamp.version, version)) return { action: 'current' }
  try {
    const body = await readFile(SKILL_BODY_URL, 'utf8')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, renderInstalledSkill(body, version), 'utf8')
  } catch (cause) {
    return { action: 'failed', reason: (cause as Error).message }
  }
  return stamp === undefined ? { action: 'installed' } : { action: 'updated', from: stamp.version ?? 'unstamped' }
}
