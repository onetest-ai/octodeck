/** The `deck_view` canonical value, as logged on the tool result. */
export interface DeckViewData {
  readonly deckId: string
  readonly route: string
  readonly slideCount: number
  readonly theme: string
}

export interface DeckCanvasProps {
  readonly view: DeckViewData
  readonly slide: number
  readonly onSlide: (slide: number) => void
}

/**
 * The deck canvas: a 16:9 frame on the live preview plus slide navigation.
 * Octodeck scales its fixed frame to whatever box it is given, so the panel
 * only sizes the frame; dragging the details boundary rescales the deck.
 */
export function DeckCanvas({ view, slide, onSlide }: DeckCanvasProps) {
  return (
    <div>
      <div style={{ aspectRatio: '16 / 9', width: '100%' }}>
        <iframe
          title={view.deckId}
          src={`${view.route}#${slide}`}
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      </div>
      <div>
        <button type="button" aria-label="Previous slide" disabled={slide <= 1} onClick={() => { onSlide(slide - 1) }}>←</button>
        <span>{slide} / {view.slideCount}</span>
        <button type="button" aria-label="Next slide" disabled={slide >= view.slideCount} onClick={() => { onSlide(slide + 1) }}>→</button>
      </div>
    </div>
  )
}
