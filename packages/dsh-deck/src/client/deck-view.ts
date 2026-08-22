/**
 * The `deck_view` canonical value, as logged on the tool result.
 *
 * Declared here rather than beside a component so both halves of the browser
 * plugin — the transcript row and the canvas — depend on the value, not on
 * each other.
 */
export interface DeckViewData {
  readonly deckId: string
  readonly route: string
  readonly slideCount: number
  readonly theme: string
}
