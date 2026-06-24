# Presentation Design Principles

Read this when shaping the deck as a whole — its story, hierarchy, and what each
slide is for. `design.md` covers the *look* (color, type, motif); this covers how
slides **communicate**. These are the principles a layout serves; pick the layout
(see `layouts.md`) to fit the principle, not the other way around.

## 1. One idea per slide
Each slide makes a single point. If you're tempted to add a second idea, that's a
second slide. Crowded slides split the audience's attention and dilute both ideas.
A deck of 20 focused slides beats 10 dense ones.

## 2. The title carries the message (assertion–evidence)
Write the title as the **takeaway sentence**, not a topic label. "Q3 revenue" is a
label; "Q3 revenue grew 40% on mobile" is the point. The body is then the *evidence*
for that assertion — a chart, a stat, a diagram. If someone reads only the titles,
they should get the argument. This single habit does more for clarity than any visual.

## 3. Narrative arc — the deck is an argument, not a list
Slides are beats in a story, ordered so each earns the next. Useful spines:
- **SCQA:** Situation → Complication → Question → Answer.
- **Problem → Insight → Solution → Proof → Ask.**
Open by framing why this matters; build tension; resolve it; close on the ask.
Signpost the structure with section dividers so the audience always knows where they are.

## 4. Visual hierarchy — guide the eye
Every slide has **one focal point**. Use size, weight, color, and position to rank
elements so the eye lands on the most important thing first, then the supporting
detail. If everything is bold, nothing is. The title or the hero visual usually wins;
make the gap between levels obvious (a 64px title over 22px body, not 28 over 22).

## 5. CRAP — the four arrangement rules
- **Contrast:** make different things clearly different (don't be timid — big vs small, dark vs light).
- **Repetition:** repeat type, color, spacing, and the motif so the deck feels unified.
- **Alignment:** every element lines up with something; nothing is placed arbitrarily. Misalignment reads as sloppy even when nothing is "wrong."
- **Proximity:** group related items close, separate unrelated ones with space. Grouping *is* meaning.

## 6. Reduce cognitive load
- Chunk to **3–5 items**; the audience can't hold more at a glance. Group or cut beyond that.
- Kill clutter: every line, box, and word should earn its place. Remove decoration that doesn't carry meaning (chartjunk, gratuitous icons, boxes around everything).
- Prefer a picture/diagram/stat over a paragraph when it carries the idea faster.

## 7. Whitespace is structural, not wasted
Breathing room directs attention and signals confidence. But **fill the frame**
(non-negotiable): whitespace should be *deliberate* margin and grouping, not a small
band of content stranded in a large empty slide. Generous, even margins; consistent gaps.

## 8. Readable from the back of the room
Slides are seen at distance on a projector at end of day. Body text large, strong
contrast, short lines. If you'd squint at it on a laptop, it's unreadable on a wall.
This is why Octodeck sizes everything on a scaling 16:9 canvas — keep type in that scale.

## 9. Consistency / system over one-offs
Decide the rules once — title position, gap rhythm, card style, accent usage — and
apply them everywhere. A consistent system reads as designed; per-slide improvisation
reads as AI-generated. (This is exactly why Octodeck themes are a shared contract.)

## 10. Data visualization
- One message per chart; state it in the chart's title (principle #2 again).
- Label directly on the data, not in a distant legend, when you can.
- Strip non-data ink — gridlines, borders, 3D, heavy backgrounds.
- For a single comparison, a big number or a two-bar contrast beats a busy chart.

## 11. The slide supports the speaker
Slides are not the script. Put the headline and the evidence on the slide; keep the
nuance in the talk track and (if needed) speaker notes. A slide the presenter reads
aloud word-for-word is redundant.

## 12. Every line of text must add information
A subtitle/caption that just narrates the diagram below it ("planning composes the
mission, then build, then test…") is dead weight — the picture already says that.
The sub-line's job is the **takeaway the picture *doesn't* show**: the "so what", the
leverage point, the cost, the non-obvious implication. If you can delete a caption and
lose no information, delete it. Test: read the sub-line *without* looking at the body —
does it teach you something new? If not, rewrite or cut it.

## 13. A schema must be causally true, not just pretty
A diagram makes an implicit claim about how things relate (order, cause, containment,
who-coordinates-whom). If that claim is wrong, a *beautiful* diagram is worse than
plain text — it confidently misinforms. Trace the real flow before styling: does the
release really happen *after* the fix, not before? Is the orchestrator *above* the
roles it coordinates? Is the loop's arrow pointing the way work actually moves? Get the
logic right first; polish second. (This is the diagram twin of principle #2.)

---

**How to apply:** before building a slide, name its one idea (1) and write its title
as the assertion (2). Place it in the narrative (3). Pick the layout from
`layouts.md` that fits that idea, choose a focal point (4), arrange with CRAP (5),
cut to 3–5 chunks (6), and size for the back of the room (8). Then verify (qa.md).
