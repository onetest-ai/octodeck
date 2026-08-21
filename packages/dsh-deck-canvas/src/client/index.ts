import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Pulls in ui-tool's `declare module '@deepseek-ai/dsh-client-ui-slots'`
// augmentation, which is what declares the `'tool.call.toolview'` slot name
// and its keyed registration overload in the first place — without this
// import, `ctx.slots.register({ name: 'tool.call.toolview', ... })` below
// has no slot named that to register against, and typechecking this package
// (added to CI in Finding 7's fix) fails.
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
// ui-tool's augmentation above in turn depends on ui-conversation's own
// `declare module` for `'conversation.chat.node'` and
// `'conversation.details.tool'` (the slot names its keyed toolview and
// single-occupant details registrations extend) — the full declaration-merge
// chain has to be pulled in for the `tool.call.toolview` slot to typecheck.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// ...and ui-conversation's own slots depend on ui-layout's `declare module`
// for the top-level `'conversation'`/`'details'` slot names.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
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
