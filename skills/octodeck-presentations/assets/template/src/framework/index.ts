/**
 * Octodeck — a tiny TypeScript framework for presentation-like webpages.
 * Slides are plain TS components: `(ctx) => HTMLElement`.
 */
import './contract.css'
import './styles.css'

export { Deck } from './deck'
export { h, raw } from './h'
export type { Child } from './h'
export type { Slide, SlideContext, SlideResult, DeckOptions } from './types'
export { defineTheme, applyTheme, applyMode } from './theme'
export type { Theme, Mode } from './theme'

// Slide templates + layout/content components.
export {
  TitleSlide,
  SectionSlide,
  StatementSlide,
  HeaderSlide,
  Columns,
  Grid,
  Stack,
  Heading,
  Subheading,
  Kicker,
  Note,
  Bullets,
  Card,
  Metric,
  Image,
  Code,
  SplitSlide,
  Bento,
  Tile,
  Sequence,
  Step,
  Quote,
  LogoWall,
} from './components'
export { Diagram } from './diagram'
export type { DiagramSpec, DiagramNode, DiagramEdge } from './diagram'
export type {
  ColSpec,
  ColumnsOptions,
  GridOptions,
  StackOptions,
  BulletsOptions,
  CardOptions,
  MetricOptions,
  ImageOptions,
  TitleSlideOptions,
  SectionSlideOptions,
  StatementSlideOptions,
  HeaderSlideOptions,
  SplitSlideOptions,
  BentoOptions,
  TileOptions,
  SequenceOptions,
  StepOptions,
  QuoteOptions,
  Logo,
} from './components'

import { Deck } from './deck'
import type { DeckOptions, Slide } from './types'

/** Convenience bootstrap: `deck(slides).start()`. */
export function deck(slides: Slide[], options?: DeckOptions): Deck {
  return new Deck(slides, options)
}
