# Layout Catalog — choosing and using each optimally

Read this when deciding how to lay out a slide. Each archetype lists **when** to
reach for it, **how much content** it holds, the **Octodeck composition**, what makes
it work, and the pitfalls. The meta-rule: **one idea per slide, and vary the
layout slide-to-slide** — repeating the same shape is the fastest way to look
templated.

Quick picker:

| The slide's job | Layout | Octodeck |
|---|---|---|
| Open / close the deck | Title / Closing | `TitleSlide` · `StatementSlide` |
| Announce a new part | Section divider | `SectionSlide` |
| Land one big idea | Single focus / Statement | `StatementSlide` · `HeaderSlide` |
| Show the plan | Agenda | `HeaderSlide` + numbered `Sequence` (vertical) |
| Two related things | Two-column | `HeaderSlide` + `Columns('50/50' | '60/40')` |
| Parallel items (3–4) | N-up cards | `HeaderSlide` + `Columns(3|4)` of `Card` |
| Weigh A vs B | Comparison | `Columns('50/50')`, two contrasting cards |
| Feature wall (mixed weight) | Bento | `Bento` + `Tile({span,rowSpan})` |
| Numbers that impress | Stat / KPI | `Metric` in `Columns`/`Bento` |
| Steps / time / agenda | Process · timeline | `Sequence` + `Step` (orientation flips it) |
| How the system fits | Architecture / flow | `Diagram` (see diagrams.md) |
| Central concept + parts | Hub-and-spoke | center medallion + `Columns` or `Diagram` |
| Story + picture | Image-led / split | `SplitSlide({ratio, side, media})` |
| Proof from a customer | Testimonial | `Quote` (+ `LogoWall`) |

---

## Title / Opener
**When:** first slide. **Holds:** eyebrow, title, one-line subtitle, maybe a date/author.
**Octodeck:** `TitleSlide`, usually on the **dark** mode of the theme.
**Optimal:** make the title the largest type in the deck; keep the subtitle to one
sentence that states the payoff. Let the brand motif (medallion, mark) appear here.
**Pitfall:** cramming agenda or detail onto the cover. The cover sets tone, nothing more.

## Section divider
**When:** between major parts, to give the audience a breath and a signpost.
**Holds:** a big number/part name + a short section title.
**Octodeck:** `SectionSlide({ number, title, subtitle? })`.
**Optimal:** reuse the same divider treatment for every section so they read as a
series. Often dark to contrast the light content slides ("sandwich").
**Pitfall:** skipping dividers in a long deck — the audience loses the thread.

## Single focus / Big statement
**When:** one idea deserves the whole slide — a thesis, a punchline, a pivot.
**Holds:** one large line (≤ ~12 words), optional attribution.
**Octodeck:** `StatementSlide({ text, cite? })`, or `HeaderSlide` with a single large element.
**Optimal:** this is your highest-impact layout — use it at the emotional beats.
Whitespace is the point; resist adding bullets.
**Pitfall:** turning it into a paragraph. If it needs explanation, it's two slides.

## Agenda / Table of contents
**When:** early, to set expectations for a longer talk.
**Holds:** 3–6 numbered sections, each one short line.
**Octodeck:** `HeaderSlide` + `Sequence({ orientation: 'vertical', numbered: true })` of `Step`.
**Optimal:** mirror these exact labels on the section dividers later — consistency
is what makes an agenda useful.
**Pitfall:** a 10-item agenda. Group to ≤6; nobody remembers more.

## Two-column
**When:** two related things — claim + evidence, text + chart, narrative + figure.
**Holds:** a column of prose/bullets and a column of visual/support.
**Octodeck:** `HeaderSlide` + `Columns('60/40' | '50/50', align:'center')`.
**Optimal:** put the wider column on the argument, the narrower on the figure/stat.
Vertically center so the two read as a pair.
**Pitfall:** two equally dense text columns — that's a wall of words, not a layout.

## N-up cards (parallel items)
**When:** 3–4 sibling items of equal importance (capabilities, pillars, options).
**Holds:** per card: an icon, a title, a short list or sentence.
**Octodeck:** `HeaderSlide` + `Columns(3|4)` of `Card` (or a deck-local card with a check-list).
**Optimal:** keep cards **equal height** and titles to a fixed (e.g. 2-line) height so
underlines/lists align across the row — misaligned cards are the classic "jump."
Cap each card's list so the densest one still fits the 720px frame.
**Pitfall:** 6+ cards (too small to read), or cards of wildly different content length.

## Comparison
**When:** A vs B, before/after, pros/cons, old way/new way.
**Holds:** two (or two-of-three) parallel columns with matched structure.
**Octodeck:** `Columns('50/50')` of two cards; differentiate with header color/accent.
**Optimal:** keep the two sides structurally identical (same rows) so differences pop.
A center medallion or arrow can show the resolution between them.
**Pitfall:** asymmetric structure that makes comparison hard.

## Bento (asymmetric grid)
**When:** a feature wall or year-in-review where items have **different weights**.
**Holds:** a hero tile (2×2) plus several smaller tiles, mixing text/stat/icon.
**Octodeck:** `Bento({ cols, rows })` + `Tile({ span, rowSpan, accent? })`.
**Optimal:** give the most important item the big tile; let the rest fill around it.
Tiles reuse the panel material, so they theme automatically.
**Pitfall:** a uniform grid pretending to be bento — if everything's equal, use `Columns`/`Grid`.

## Stat / KPI
**When:** numbers are the message (growth, scale, savings).
**Holds:** 3–6 big numbers with short labels; one may be the hero.
**Octodeck:** `Metric({ value, label })` placed in `Columns`/`Grid`/`Bento`.
**Optimal:** make the numbers large (the slide's biggest type), labels small and muted.
Round to the memorable figure; one stat per claim.
**Pitfall:** a number with no label, or a dense table masquerading as "stats."

## Process · timeline · agenda (Sequence)
**When:** ordered steps, a pipeline, a roadmap, or a numbered agenda.
**Holds:** 3–6 steps, each a short label + title + one line.
**Octodeck:** `Sequence({ orientation })` + `Step({ label, title })`. Horizontal +
connector → process/roadmap; vertical + numbered → agenda/TOC.
**Optimal:** keep steps to one line each; the connectors carry the "and then."
**Pitfall:** more than ~6 steps in a row (they get tiny) — split or summarize.

## Architecture / flow (Diagram)
**When:** how components/systems connect.
**Octodeck:** `Diagram` — deterministic grid placement (see **diagrams.md** for the rules).
**Optimal:** simplify ruthlessly — a deck diagram is a story, not the real topology.
**Pitfall:** porting a real architecture diagram wholesale; it won't read on a projector.

## Hub-and-spoke / relationship
**When:** a central concept with satellites (a platform feeding markets, a core + modules).
**Holds:** one center element + 3–6 surrounding items.
**Octodeck:** a center medallion/`Card` with `Columns` of items either side, or a `Diagram`
with the hub as an `accent` node and edges to each spoke.
**Optimal:** make the hub visually dominant; spokes equal and evenly spaced.
**Pitfall:** crowding the center so the relationship is unclear.

## Image-led / split
**When:** a story, a product shot, an emotional beat — visual carries it.
**Holds:** one strong image (full-bleed) + a short headline/quote.
**Octodeck:** `SplitSlide({ ratio:'58/42', side, media })`; media bleeds to the edge.
**Optimal:** let the image breathe to the slide edge; keep text minimal over/aside it.
**Pitfall:** a tiny image boxed in the middle with padding — bleed it.

## Testimonial / social proof
**When:** a customer voice or logos build credibility.
**Octodeck:** `Quote({ author, role, avatar })`, optionally with `LogoWall` below.
**Optimal:** one strong quote beats three weak ones; keep the measure wide enough that
it isn't a narrow ribbon of text. Attribution small and muted under it.
**Pitfall:** a cramped quote column or a wall of logos with no hierarchy.

## Closing / CTA / summary
**When:** the last slide — the ask, the recap, or the memorable line.
**Octodeck:** `StatementSlide` (a line to remember) or a small `HeaderSlide` recap; often dark to bookend the cover.
**Optimal:** end on one clear next step or one sentence. Bookend the visual treatment of the opener.
**Pitfall:** a dense "thank you + 6 bullets + contact grid" — pick one thing.

---

## Composed diagrams (HTML/CSS) — the workhorse for system/flow slides

The `Diagram` component is for node-and-edge graphs. But many of the best
explanatory slides (pipelines, swim-lanes, layered architectures, org/role flows,
comparison matrices) are **not** node graphs — they're laid out far more cleanly as
plain HTML/CSS using the same `--octo-*` contract. Build these as small deck-local
components (a flex/grid of themed chips), not as `Diagram`. **Pick your medium:**

| The slide is… | Use |
|---|---|
| a small node-and-edge graph (≤ ~6 nodes, no loops) | `Diagram` (grid + orthogonal edges) |
| a flow with a **loop / decision / branch** (git-graph, state machine, decision fork) | **bespoke inline SVG** (see `diagrams.md`) |
| a **swim-lane / pipeline** (lanes of ordered steps) | **HTML/CSS**: a column of lane rows |
| a **layered architecture** (tiers stacked, top→bottom) | **HTML/CSS**: full-width bands + a chip/card row per tier |
| a **comparison** of two things across dimensions | **HTML/CSS**: a CSS-grid matrix |
| a **containment hierarchy** (A holds B holds C) | a tree — bespoke SVG bus-connectors **or** nested boxes |

**Reusable HTML/CSS patterns (all theme through the contract):**

- **Lane / swim-lane.** A row = `[label cell] [flow of chips]`. Chips are `flex:1`
  equal-width boxes (panel material) separated by `›`. Tint each lane with a single
  CSS var (`--lane`) so the label, arrows, and accent all derive from one colour —
  one class per lane colour. Great for "a pipeline per X", role hand-off relays.
- **Layered stack.** Full-width bands for the framework/foundation tiers, a row of
  cards for the diverse middle tier, and a small centred **connector pill** between
  tiers carrying the relationship ("routes to", "assembled from"). Reads top-down as
  an architecture. Colour-code the middle cards by category; repeat a label (e.g.
  three "Entire SDLC" cards on different stacks) to make a "same-type-≠-same-thing" point.
- **Connector pills between rows.** A centred, bordered, slightly-glowing pill is the
  cleanest way to show a hand-off/quantity between stacked blocks ("▾ 12 tasks",
  "↺ loops back"). Make them *prominent* (they carry the through-line) and put the
  in-context numbers there ("$14–19 each").
- **Comparison matrix.** A CSS grid `dimension | A | B`; give the focal column an
  accent-tinted background band and accent header. Aligns the two sides row-by-row —
  far clearer than two separate cards. Add a one-line **summary** under it.
- **Mode / status badges.** A small right-aligned badge per row ("human-led" vs
  "dynamic workflow") makes a cross-cutting property instantly comparable down a column.

**Rules these earned (each fixed a real miss):**
- **Items become pills, not prose.** A dot-separated text list (`A · B · C`) reads as
  unfinished; render each item as a chip. It's the difference between "designed" and "a caption".
- **Chips size to content.** In HTML, `flex:1` auto-sizes; in bespoke SVG you must
  compute width from text length (`text.length × ~0.6em + pad`) — never hardcode.
- **Equal-height *and* content-sized cards.** `align:'stretch'` alone makes a row of
  cards fill the *whole body* (too tall). Wrap the `Columns` in a plain `<div>` first,
  then `stretch` equalises them to the **tallest card's content**, not the slide.
- **Don't put a lone thick coloured border on one side of a card.** It reads as a 3-D
  bevel / template tell. Colour-code with the **title colour, a badge, or a full tint** instead.
- **One `--var` per colour family.** Define `.x--blue{--c:…}` and let fill/border/arrow
  all read `var(--c)`; keep those hues consistent with any sibling slide that re-uses them.
