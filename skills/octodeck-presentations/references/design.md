# Visual Design Decisions

Read this when choosing how a deck should look. These principles are what
separate a deck that feels designed-for-this-topic from a generic template.

## Palette

- **Content-informed, not default.** If swapping your colors into an unrelated
  deck would still "work," they aren't specific enough. A coffee company is deep
  green + cream; a fintech is not generic blue. Choose for *this* topic.
- **Dominance, not equality.** One color carries 60–70% of the visual weight,
  1–2 supporting tones, and one sharp accent. Equal weighting reads as flat and
  unconsidered.
- **Dark/light sandwich.** Dark title + closing slides, light content slides in
  between — or commit to dark throughout for a premium feel. Decide deliberately;
  don't drift.

Reference palettes (primary / secondary / accent) — match the topic:

| Theme | Primary | Secondary | Accent |
|---|---|---|---|
| Midnight Executive | `1E2761` navy | `CADCFC` ice | `FFFFFF` white |
| Forest & Moss | `2C5F2D` forest | `97BC62` moss | `F5F5F5` cream |
| Warm Terracotta | `B85042` terracotta | `E7E8D1` sand | `A7BEAE` sage |
| Charcoal Minimal | `36454F` charcoal | `F2F2F2` off-white | `212121` black |
| Berry & Cream | `6D2E46` berry | `A26769` rose | `ECE2D0` cream |
| Teal Trust | `028090` teal | `00A896` seafoam | `02C39A` mint |
| Coral Energy | `F96167` coral | `F9E795` gold | `2F3C7E` navy |
| Cherry Bold | `990011` cherry | `FCF6F5` off-white | `2F3C7E` navy |

## Motif

Pick **one** distinctive, repeatable element and carry it across every slide: a
brand medallion, icons in tinted squares, a thick single-side border, a bottom
takeaway bar. Repetition is what makes a set of slides feel like one deck.

## Every slide earns a visual

Image, diagram, icon row, stat callout, or shaped block. A plain title + bullets
slide on a flat background is forgettable. If a slide is only prose, it's a
candidate to merge, cut, or redesign.

## Typography

Pair a heading font with personality and a clean body font. Serif display + sans
body reads as editorial and intentional. Avoid defaulting to Arial.

| Header | Body |
|---|---|
| Lora / Georgia / Cambria / Palatino | Inter / Calibri / Garamond |

Type scale at a 1280×720 canvas (Octodeck's default): **title 44–68px**, section
header 24–32px, body 20–24px, captions 14–16px. Keep a strong size contrast —
a title needs to clearly outrank body text.

## Spacing

- Generous, consistent margins from the slide edge; never crowd the frame edge.
- Pick one gap rhythm and reuse it — don't mix random spacings.
- Leave breathing room, but not dead bands (see non-negotiable #2: fill the frame).
- Left-align body text and lists. Center only titles and hero statements.

## Anti-patterns (the AI-generated tells)

- ❌ Plain title + bullets on a flat background — add a visual.
- ❌ **Decorative accent line under a slide title** — a hallmark of AI decks; use
  whitespace and weight instead. (Structural underlines *inside* a card, taken
  from a real source design, are fine — the tell is the lone rule under the
  slide's main title.)
- ❌ Default blue unrelated to the topic.
- ❌ Centered body text and lists.
- ❌ The same layout on every slide — vary columns, bento, split, sequence, diagram.
- ❌ Random / inconsistent gaps and margins.
- ❌ One styled slide and the rest plain — commit fully or keep it simple throughout.
- ❌ Tiny title / weak size contrast.
- ❌ Low-contrast text or icons (light on light, dark on dark).
