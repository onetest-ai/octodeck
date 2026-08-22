/**
 * Resolved slot props (Step 5 research; harness checkout, read-only):
 *
 * The brief's assumption was to register `DeckDetails` into
 * `conversation.details.tool` (packages/client/ui-conversation/src/client/
 * contract/slots.ts). That slot is `kind: 'single'` — ONE occupant renders
 * the output of EVERY tool call the user selects. Its shipped occupant
 * (`ToolDetails` in packages/client/ui-tool/src/client/tool/ToolDetails.tsx)
 * hard-dispatches a fixed chain of card models (terminal/read/diff/search/
 * web) purely from `owner.block`; replacing it with a deck-only renderer
 * would silently drop every other tool's details output, exactly the trap
 * the slot's own doc comment names ("taking this seat means rendering every
 * tool's output, not just the ones you know... a per-tool renderer belongs
 * in the keyed `tool.call.toolview` seat instead").
 *
 * `tool.call.toolview` (packages/client/ui-tool/src/client/contract/
 * slots.ts) is `kind: 'keyed'`, dispatched by wire tool name — registering
 * under key `'deck_view'` is additive: it replaces only the generic row for
 * `deck_view` calls (inline in the transcript, via ToolCallTree), leaving
 * every other tool's rendering untouched. Its owner share (`ToolCallOwnerProps`)
 * passes `{ callId, toolName, block: ToolCallBlock, cwd?, home?, openFile,
 * inspect? }` directly — no chat-store lookup needed, unlike
 * `DetailsPanel.tsx`'s single-occupant dispatch, which derives call material
 * from `useSession` + the shared store because it owns the whole panel
 * across every tool.
 *
 * Neither seat's owner share carries the tool's raw canonical return value:
 * `ToolCallBlock` (packages/client/runtime/src/client/sessions/
 * conversation.ts) exposes only `content` (model-facing `ContentBlock[]`)
 * and `meta?: JsonValue` on its settled `ToolResultNode` form. `meta` is
 * populated only when the tool declares `output.presentationMeta` in
 * `defineTool` (packages/core/tools/src/schema.ts) — `deck_view` did not.
 * packages/dsh-deck/src/index.ts now declares
 * `presentationMeta: (_args, value) => value` on `deck_view`'s output so the
 * canonical `DeckView` value threads onto `meta`, verbatim, for both live
 * rendering and session-log replay (the same mechanism the harness
 * documents as "Pure replayable presentation metadata for direct top-level
 * calls").
 *
 * This file therefore registers into `tool.call.toolview` keyed
 * `'deck_view'`, not `conversation.details.tool` — the documented fallback
 * named in this task's brief.
 */
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { DeckViewData } from './deck-view.ts'

/**
 * Narrow a logged tool-result value to the fields the canvas renders.
 *
 * The value crosses from a persisted tool result, so it is validated rather
 * than asserted: another tool's result reaching this renderer must produce
 * nothing, not an empty frame.
 * @param value - the settled block's projected `meta`.
 * @returns the deck value, or null when the shape is not one.
 */
export function asDeckView(value: unknown): DeckViewData | null {
  if (typeof value !== 'object' || value === null) return null
  const { deckId, route, slideCount, theme } = value as Record<string, unknown>
  if (typeof deckId !== 'string' || typeof route !== 'string') return null
  if (typeof slideCount !== 'number' || typeof theme !== 'string') return null
  return { deckId, route, slideCount, theme }
}

/** Props: the one field the row reads off `tool.call.toolview`'s owner share. */
export interface DeckToolviewProps {
  readonly block: ToolCallBlock
}
