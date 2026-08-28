/**
 * The bundled `octodeck-deck` skill: how to author a deck with this plugin's
 * tools.
 *
 * A skill rather than the agent preset this package used to ship. The preset
 * put the same guidance in every session's system prompt, and to do it had to
 * restate a composition — file tools, a shell — that the deployment's own
 * preset already provides, silently dropping everything it did not restate.
 * The knowledge is task-specific, so it belongs where the model pays for it
 * only while building a deck; the tools it describes mount on the host plane
 * and are in every session's catalog regardless.
 *
 * @module @onetest/dsh-deck/skill
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import {
  BUNDLED_SKILL_RANK,
  type SkillCandidate,
  type SkillDefinition,
  type SkillProvider,
} from '@deepseek-ai/dsh-skill'

/** Unique provider name registered on `ctx.skills`. */
export const PROVIDER_NAME = 'octodeck-deck'

/**
 * The skill body, read from the packaged asset on each load.
 *
 * The asset carries no frontmatter: this provider supplies the name,
 * description, and invocation policy, and the file is returned verbatim as
 * `content`. A metadata block left in it would reach the model inside
 * `<skill_content>` and state the description a second place it could drift
 * from. (The filesystem provider strips frontmatter for the same reason;
 * nothing strips it here.)
 */
export const SKILL_BODY_URL = new URL('../assets/octodeck-deck.md', import.meta.url)

/**
 * Where the skill's relative resources resolve from.
 *
 * The packaged asset directory, so guidance that references a file beside the
 * body keeps working from an installed copy.
 */
const RESOURCE_BASE = {
  kind: 'directory',
  path: fileURLToPath(new URL('../assets/', import.meta.url)),
} as const

/**
 * Both surfaces. The model loads it when a deck task matches the description;
 * a user can invoke it directly to put the same guidance in front of a model
 * that did not reach for it.
 */
const INVOCATION = { modelInvocable: true, userInvocable: true } as const

/** Routing description; the only text the session catalog carries. */
const DESCRIPTION =
  'Build a presentation deck in this session with Octodeck — create it with deck_create, author slides as TypeScript in .deck/<name>/slides.ts, and show it with deck_view. Use whenever the user asks for a deck, slides, a presentation, or a pitch, and when editing anything under .deck/. Covers the framework components, the layout and theming rules that keep a deck from looking broken, and how the live canvas updates.'

/** The single candidate this provider lists. */
export const CANDIDATE: SkillCandidate = {
  name: 'octodeck-deck',
  description: DESCRIPTION,
  invocation: INVOCATION,
  provider: PROVIDER_NAME,
  source: 'bundled',
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
}

/**
 * The provider registered on `ctx.skills`.
 *
 * Discovery is immutable, so the registration control is ignored. The body is
 * read per `get()` rather than at mount: the registry does not cache
 * definitions, and reading on demand keeps an edited asset live in a
 * development checkout without restarting the host.
 */
export const skillProvider: SkillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get(): Promise<SkillDefinition> {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, 'utf8'),
    }
  },
}
