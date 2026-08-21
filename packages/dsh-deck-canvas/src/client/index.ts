import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { DeckToolview } from './DeckToolview.tsx'

/** Required service: the slot registry (see DeckToolview.tsx for the slot choice). */
export const inject = ['slots']

/**
 * Browser half: register the deck canvas as the keyed `tool.call.toolview`
 * renderer for `deck_view` calls — not `conversation.details.tool` (see the
 * resolved-props note at the top of DeckToolview.tsx). `slots.inject` waits
 * for the slot declaration (made by ui-tool's `conversation.chat.node`
 * registration) rather than assuming apply order, and withdraws the
 * contribution if that declaration collapses.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'deck_view',
  }, DeckToolview))
}
