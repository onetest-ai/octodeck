import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { THEMES } from './definition.ts'
import { mountPreviewRoute, type PreviewHostContext } from './host/preview-route.ts'
import { createDeck, viewDeck } from './tools/deck-create.ts'

/** Deployment-varying choices, changeable from cordis.yml. */
export interface Config {
  /** Base path the preview is served under. */
  readonly base: string
}

/**
 * Runtime schema cordis validates this plugin's config against before its
 * fiber starts (`Plugin.Base.Config?: StandardSchemaV1<any, T>`). Without
 * it, a malformed `base` — missing, wrong type, no leading slash — would
 * pass through unchecked instead of failing loud at load. Hand-written
 * against the tiny StandardSchemaV1 protocol (https://standardschema.dev,
 * a `~standard` object with `version`, `vendor`, and `validate`) rather than
 * a schema library: `@deepseek-ai/schemastery` is present in `node_modules`
 * only transitively here, and a single required field does not earn a new
 * declared dependency.
 */
export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: '@onetest/dsh-deck',
    validate(value: unknown) {
      if (typeof value !== 'object' || value === null) {
        return { issues: [{ message: 'expected a config object' }] }
      }
      const base = (value as { base?: unknown }).base
      if (typeof base !== 'string' || base.length === 0 || !base.startsWith('/')) {
        return {
          issues: [{
            message: `base must be a non-empty string starting with "/", received ${JSON.stringify(base)}`,
            path: ['base'],
          }],
        }
      }
      return { value: { base } }
    },
  },
}

export const inject = ['tools', 'webServer']

/**
 * Mount the deck capability: the preview route plus the two model-facing tools.
 *
 * `ctx` is typed as `Context & PreviewHostContext` rather than bare `Context`:
 * no installed package augments cordis's `Context` with `webServer`, so bare
 * `Context` does not satisfy what `mountPreviewRoute` requires.
 * `PreviewHostContext` supplies the structural `webServer` and `effect` this
 * plugin needs without a `declare module` augmentation of its own.
 * @param ctx - plugin context.
 * @param config - the row's validated configuration.
 */
export function apply(ctx: Context & PreviewHostContext, config: Config): void {
  const workspace = process.cwd()
  mountPreviewRoute(ctx, { workspace, base: config.base })
  const options = { workspace, base: config.base }

  ctx.tools.register(defineTool({
    name: 'deck_create',
    description: 'Create a presentation deck in the workspace. Slides are TypeScript; edit slides.ts to author them.',
    parameters: {
      name: { type: 'string', required: true, description: 'Deck name: lowercase letters, digits, and dashes' },
      theme: { type: 'string', description: `One of ${THEMES.join(', ')}` },
      title: { type: 'string', description: 'Deck title; defaults to the name in title case' },
    },
    output: {
      // Every explicit `dsh-tools` object schema must declare
      // `additionalProperties`, and one with no `properties` infers
      // `Record<string, JsonValue>` — not assignable to `DeckCreated`, which
      // has no index signature. This closed, fully-declared schema mirrors
      // `DeckCreated` field-for-field so `execute`'s return type matches.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deckId: { type: 'string', required: true },
          directory: { type: 'string', required: true },
          slidesPath: { type: 'string', required: true },
          route: { type: 'string', required: true },
          theme: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Created deck ${value.deckId}; edit ${value.slidesPath}` }],
    },
    execute: async (args, exec) => createDeck(args, options, exec),
  }))

  ctx.tools.register(defineTool({
    name: 'deck_view',
    description: 'Open a deck on the preview canvas.',
    parameters: { name: { type: 'string', required: true, description: 'Deck name' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deckId: { type: 'string', required: true },
          route: { type: 'string', required: true },
          slideCount: { type: 'integer', required: true },
          theme: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Deck ${value.deckId}: ${value.slideCount} slide(s)` }],
    },
    execute: async (args, exec) => viewDeck(args, options, exec),
  }))
}
