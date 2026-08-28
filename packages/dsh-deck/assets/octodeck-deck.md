# Building a deck with Octodeck

A deck here is **TypeScript, not a slide editor**. `deck_create` scaffolds one, you author it by editing a file, and the canvas the user is watching repaints as you save.

## The loop

1. `deck_create({ name, theme?, title? })` writes `.deck/<name>/` into the session's workspace: `slides.ts`, `deck.json`, `deck.css`.
2. Edit `slides.ts` with your file tools. This is the actual authoring — everything else is scaffolding.
3. `deck_view({ name })` opens the canvas.

Editing `slides.ts` **repaints the open canvas on its own**. Do not call `deck_view` after every edit; call it once so the deck is on screen, and again after a structural change so the reported slide count is current.

Themes: `midnight` (default), `protocol`, `primer`, `radiant`, `commit`, `octo-glass`.

## What a slide is

A slide is a function returning an element. `slides.ts` exports them in order:

```ts
import { TitleSlide, HeaderSlide, Bullets, Columns, Metric } from 'octodeck/framework'
import type { Slide } from 'octodeck/framework'

export const slides: Slide[] = [
  () => TitleSlide({ title: 'Quarterly review', subtitle: 'Engineering' }),
  () => HeaderSlide({
    title: 'Where the time went',
    body: Columns({ children: [
      Metric({ value: '61%', label: 'shipped on estimate' }),
      Bullets({ items: ['Auth migration', 'Search rewrite', 'On-call rotation'] }),
    ] }),
  }),
]
```

Compose from the framework rather than hand-rolling markup.

**Slide templates:** `TitleSlide`, `SectionSlide`, `StatementSlide`, `HeaderSlide`, `SplitSlide`.

**Layout:** `Columns`, `Grid`, `Stack`, `Bento`, `Tile`, `Sequence`, `Step`.

**Content:** `Bullets`, `Card`, `Metric`, `Image`, `Code`, `Quote`, `LogoWall`, `Kicker`, `Heading`, `Subheading`, `Note`.

## Three rules the framework enforces

**Size in `cqw` / `cqh` / `rem`, never `vw` / `vh`.** The deck is a fixed 1280×720 canvas that is *scaled* to whatever space it has. Window units are measured against the window, not the canvas, so they break the moment the canvas is not full-screen — which it never is here, because it sits beside a conversation.

**Never hardcode a colour.** Read the `--octo-*` variables. A deck that respects the contract themes for free across all six themes; one with `#1a1a2e` in it looks wrong in five of them.

**Content must fit the 16:9 frame.** No overlap, no clipping, nothing bleeding past the edge or hiding under a bar. When a slide is crowded, **split it — do not shrink the type**. Marooning content in a small band with dead space around it reads as unfinished; if you have little to say, say it bigger.

## Judgement

Prefer few words per slide. A deck is spoken over — the slide is the visual, not the transcript. Bullets should be phrases, not sentences, and a slide with more than about six of them is two slides.

Deck-local styles belong in `deck.css`, which is scaffolded for exactly that. Reach for it when a slide needs something the components do not offer, and still read the `--octo-*` contract there.

## When you cannot see it

You are authoring a deck someone else is looking at. You cannot verify a layout by reading the source — overlap and clipping are render-time facts. So prefer the framework's own templates and layout primitives, which fit by construction, over bespoke positioning that only looks right in your head; and when the user reports something off, ask what they see rather than guessing at CSS.
