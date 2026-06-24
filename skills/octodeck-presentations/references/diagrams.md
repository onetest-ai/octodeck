# Diagrams

Read this before building any diagram. Diagrams are where decks most often turn
sloppy; these rules come from real failures.

## Use `Diagram`, never an auto-layout engine

`Diagram` (`src/framework/diagram.ts`) is deterministic: you place every node on
a grid cell and edges auto-route orthogonally between them, rendered as one
responsive SVG using the theme's colors.

**Do not use Mermaid (or any solver-laid-out engine) in a deck.** Its node
positions shift between renders, overflow the slide, and ignore your theme. A
deck needs predictable placement and theme consistency more than it needs
auto-layout. (For a genuinely large graph you'd feed the same `{nodes, edges}`
spec to `elkjs` to compute positions — same authoring API — but that's rare.)

**`Diagram` routes orthogonally between cell centres, so it can't draw a clean
back-edge.** An edge between two nodes on the same row (a loop-back, a return
arrow) is drawn as a straight line through the centres — i.e. straight *through*
any node sitting between them. The moment a flow has a loop, a decision/branch, a
release-vs-fix fork, or a "merge back" arrow, stop fighting `Diagram` and
hand-author a bespoke SVG instead (see below).

## API

```ts
Diagram({
  cols: 3, rows: 3,
  nodes: {
    client: { at: [0, 1], label: 'Client', shape: 'pill' },
    api:    { at: [1, 1], label: 'API gateway', accent: true },
    db:     { at: [2, 0], label: 'Database' },
    cache:  { at: [2, 1], label: 'Cache' },
  },
  edges: [
    { from: 'client', to: 'api', label: 'HTTPS' },
    { from: 'api', to: 'db' },
    { from: 'api', to: 'cache', dashed: true },
  ],
})
```

- `nodes[key].at: [col, row]` — explicit grid placement (zero-based). Optional
  `w`/`h` spans, `shape: 'box' | 'pill'`, `accent`.
- `edges[].label` optional; `dashed`, `arrow` optional.

## The rules (each one fixes a real sloppiness)

- **Keep it simple.** A deck diagram is a *simplification*, not the real
  architecture. Fewer, larger, well-spaced nodes beat a dense graph nobody can read.
- **Labels never sit on a box face.** Edge labels render as a clean chip in the
  gap, and the gap **widens automatically** to fit the label (adaptive spacing).
  If a label looks crammed against boxes, that's the bug — give it room; never
  shrink the text to squeeze it in.
- **No smudged label overlays.** A label is a chip (bg fill + hairline border) or
  it's removed — never a text-halo smear over the connector. When a flow is
  self-explanatory, drop the labels entirely; clean reads better.
- **Shadows must render fully.** Node box-shadows should not be "chewed" (clipped)
  at the container edge. The component reserves shadow room around each node and
  padding in the viewBox; if you see clipped shadows, that padding is too small.
- **Font-to-box proportion.** Node text sits comfortably inside its box with
  padding — not jammed edge-to-edge, not overflowing onto multiple cramped lines.
  If text is too big for the box, the font is wrong, not the box. Shorten labels
  or let the cell be larger.
- **Theme-aware by default.** Nodes use the panel material role, so they're flat
  boxes in a flat theme and frosted in a glass theme automatically — don't add
  per-theme diagram CSS.

## Hand-authored SVG schemas (loops, decisions, branch flows)

When a flow needs a back-edge, a decision fork, or a "merge back" loop, build the
SVG yourself (one `<svg viewBox>` injected via `innerHTML`). It's more work but you
control every pixel. These rules each came from a real slide that got it wrong first:

- **Theme it through the contract, never hardcode color.** Style every element via
  CSS classes that read `--octo-*` (`fill`, `stroke`, and gradient `stop-color`
  accept `var()`/`color-mix()` from a CSS rule, *not* from an attribute). Then the
  schema restyles with the theme exactly like `Diagram` does.
- **Make `id`s unique per render.** Suffix every `<marker>`, `<filter>`, and
  `<linearGradient>` id with a module counter (`grad-${u}`). `url(#id)` resolves to
  the *first* match in the document, so a fixed id collides when the slide
  re-renders or another schema is mounted during a transition.
- **Labels sit ON the line, with line showing on BOTH sides.** Center an edge label
  as a chip on its edge — but if the chip is as long as the segment, the line
  vanishes and it reads as floating. Widen the gap (move the nodes apart) until a
  visible stub of line shows each side of the chip; don't shrink the chip onto a node.
- **A wide label needs a long-enough run.** A label can't be both on a short arc
  *and* clear of the adjacent node if it's wider than the space. Give it room: move
  the node, shorten the text, or route the arc wider — don't let it overlap the box.
- **Loops exit and re-enter from the side, not the bottom.** A return path should
  leave its box from the left/right *edge* and re-enter its target on the matching
  side, mirroring the forward path. Bottom-exits read as drips, not flow.
- **Keep return arcs monotonic.** A rising "merge back" curve that dips down before
  going up looks kinked. One gentle arc beats an S-curve.
- **Put sibling labels at the same height.** Two arcs whose labels sit level read as
  "smooth/symmetric"; the same arcs with labels at different heights read as messy
  even when the geometry is fine. Symmetry is most of the perceived polish.
- **Color-code semantically, and match the arrowhead to its edge.** e.g. forward =
  accent, accept = green, fix-loop = orange. Give each color its own `<marker>` (or
  use `fill="context-stroke"`) so arrowheads aren't a different color than their line.
- **Match the theme's node material.** For a glass theme, give nodes a vertical
  gradient fill + a soft `feDropShadow` + a thin top sheen line, so hand-drawn nodes
  sit alongside `Card`/`Diagram` nodes instead of looking like flat foreign boxes.
