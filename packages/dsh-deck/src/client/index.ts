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
import { DeckOverlay, type ExportFormat } from './DeckOverlay.tsx'
import { DeckRow } from './DeckRow.tsx'
import { createCanvasController } from './canvas-controller.ts'

/** Required service: the slot registry (see DeckToolview.tsx for the slot choice). */
export const inject = ['slots']

/**
 * Browser half: two registrations sharing one store.
 *
 * The deck renders on a single canvas floating over the app (`shell.overlay`,
 * a root-scoped list slot the shell documents as the seat for exactly this),
 * while each `deck_view` call leaves a compact row in the transcript that
 * points the canvas at its deck. The alternative — a live frame per call —
 * accumulates stale running documents up the conversation, which is the whole
 * reason the canvas is one surface rather than many.
 *
 * `conversation.details.tool` is not used: it is `kind: 'single'`, so taking
 * that seat would silently replace every other tool's details view (see the
 * resolved-props note atop DeckToolview.tsx).
 *
 * Both registrations close over one plugin-owned controller, which is how the
 * row's click reaches the overlay. A declared slot store cannot do this job:
 * the row's slot is session-scoped and the canvas's is root-scoped, and one
 * store handle belongs to one scope. `slots.inject` waits for each declaration rather
 * than assuming apply order, and withdraws the contribution if one collapses.
 */
export function apply(ctx: Context): void {
  const canvas = createCanvasController()
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'deck_view',
    inject: () => ({ showDeck: canvas.show }),
  }, DeckRow))
  // A list slot: entries are additive and identified by id, so this canvas
  // sits beside whatever else floats over the app rather than replacing it.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'deck-canvas',
    inject: () => ({
      hooks: { deckCanvas: canvas.store },
      close: canvas.close,
      place: canvas.place,
      setTheme: canvas.setTheme,
      setMode: canvas.setMode,
      // Replaced by the real export driver once the extractor lands; until
      // then the menu reports rather than silently doing nothing.
      startExport: (format: ExportFormat) => {
        canvas.exportDone(`${format.toUpperCase()} export is not wired up yet`)
      },
    }),
  }, DeckOverlay))
}
