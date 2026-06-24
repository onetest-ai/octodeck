# Visual QA (the bug hunt)

Read this during the verify step. **Assume there are problems — your job is to
find them.** The first render is almost never correct; if you found zero issues
on first inspection, you weren't looking hard enough.

## Capture every slide

With the dev server running, screenshot each slide (optionally across themes and
modes) using the bundled script:

```bash
node scripts/capture_slides.mjs \
  --url http://localhost:9001/<deck>.html \
  --count <N> --out /tmp/shots \
  --themes <a,b> --mode <light|dark>
```

Each navigation reloads fully (cache-busted), so slides show their base state.

## Inspect with fresh eyes

Use a **subagent** to inspect the images, even for a few slides — you've been
staring at the code and will see what you intended, not what's there. Give it the
expected content per slide and this list to check against.

## What to hunt for

- [ ] **Overlap** — text through a shape, a line through a word, content under a
      footer bar, header touching body. (The most common and worst failure.)
- [ ] **Overflow / clipping** — text cut at a box or slide edge; the last list
      item hidden; a 2-line title clipped to 1.
- [ ] **Dead space** — content marooned in a small band; the frame not filled.
- [ ] **Alignment jumps** — card headings, underlines, or list starts not aligned
      across a row; uneven column tops.
- [ ] **Diagram smells** — labels crammed between boxes, clipped node shadows,
      node text too big for its box, lines crossing through nodes.
- [ ] **Edge labels off the line** — a label that floats beside its edge instead of
      sitting on it, or a chip so long it covers the whole segment (no line visible
      on either side of it). It should sit on the line with a stub showing both sides.
- [ ] **Loop / flow smells** (hand-authored schemas) — a return arc exiting a box's
      bottom instead of its side; an arc that dips before it rises (kinked, not
      smooth); sibling labels at different heights when they should be level;
      an arrowhead a different color than the line it caps.
- [ ] **Contrast** — light text on light, dark on dark, low-contrast icons.
- [ ] **Uneven gaps** — cramped in one place, loose in another; inconsistent rhythm.
- [ ] **Edge margins** — content too close to the slide edge.
- [ ] **Leftover text** — placeholder copy, or review annotations from a source
      deck that should have been stripped.
- [ ] **Scaling** — resize the window; the deck must still fill and not reflow oddly.

## The loop

1. Capture → inspect → **list issues** (if none, look again, more critically).
2. Fix.
3. **Re-verify the changed slide** — one fix frequently breaks a neighbor.
4. Repeat until a full pass surfaces nothing new.

Do not declare success until you've completed at least one fix-and-verify cycle.
