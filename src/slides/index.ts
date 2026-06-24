import {
  h,
  TitleSlide,
  SectionSlide,
  StatementSlide,
  HeaderSlide,
  Columns,
  Grid,
  Stack,
  Bullets,
  Card,
  Metric,
  Code,
  Note,
  SplitSlide,
  Bento,
  Tile,
  Sequence,
  Step,
  Quote,
  LogoWall,
  Diagram,
} from '../framework'
import type { Slide } from '../framework'

/** A theme-tinted placeholder block standing in for a photo in the demo. */
const photo = () => h('div', { class: 'demo-photo' })
/** A neutral SVG wordmark so the logo wall reads on light and dark themes. */
const wordmark = (t: string) =>
  'data:image/svg+xml,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="32"><text x="0" y="25" font-family="sans-serif" font-size="26" font-weight="700" fill="#888">${t}</text></svg>`)

/**
 * The deck. Each entry is a TS component. This deck doubles as a gallery of the
 * built-in slide templates and layout components — see src/framework/components.ts.
 */
export const slides: Slide[] = [
  // 1 — Title template
  () => TitleSlide({
    eyebrow: 'Octodeck',
    title: 'Slide templates & layouts',
    subtitle: 'Consistent, composable building blocks for every slide.',
    footer: '→ / Space to advance · F for fullscreen',
  }),

  // 2 — Section divider template
  () => SectionSlide({
    number: '01',
    title: 'Column layouts',
    subtitle: 'One Columns component covers every ratio.',
  }),

  // 3 — Columns 50/50
  () => HeaderSlide({ kicker: 'Columns', title: 'Two columns · 50 / 50' },
    Columns({ cols: '50/50' },
      Card({ title: 'Left' }, h('p', 'Equal halves — the default when you pass two children.')),
      Card({ title: 'Right' }, h('p', 'Each column is an independent content region.')),
    ),
    Note('Code: Columns({ cols: "50/50" }, …) — or just Columns({}, a, b)'),
  ),

  // 4 — Columns 33/33/33
  () => HeaderSlide({ kicker: 'Columns', title: 'Three columns · 33 / 33 / 33' },
    Columns({ cols: '33/33/33' },
      Card({ title: 'Discover', accent: true }, h('p', 'Frame the problem.')),
      Card({ title: 'Design' }, h('p', 'Shape the solution.')),
      Card({ title: 'Deliver' }, h('p', 'Ship and measure.')),
    ),
    Note('Code: Columns({ cols: 3 }, a, b, c) — or "33/33/33"'),
  ),

  // 5 — Columns 65/35 (asymmetric)
  () => HeaderSlide({ kicker: 'Columns', title: 'Two columns · 65 / 35' },
    Columns({ cols: '65/35', align: 'center' },
      Bullets([
        'The wide column carries the argument',
        'The narrow column holds a figure, stat, or aside',
        'Pass any ratio — "70/30", [2, 1], etc.',
      ]),
      Card({ accent: true }, Metric({ value: '65/35', label: 'arbitrary ratios' })),
    ),
  ),

  // 6 — Grid of metrics
  () => HeaderSlide({ kicker: 'Grid', title: 'Uniform grids for stats' },
    Grid({ cols: 3, gap: '2rem' },
      Metric({ value: '4', label: 'slide templates' }),
      Metric({ value: '11', label: 'components' }),
      Metric({ value: '1', label: 'Columns API for every ratio' }),
      Metric({ value: '3 kB', label: 'gzipped runtime' }),
      Metric({ value: '0', label: 'JSX build steps' }),
      Metric({ value: '100%', label: 'TypeScript' }),
    ),
  ),

  // 7 — Mixed layout: prose + code, 55/45
  () => HeaderSlide({ kicker: 'Compose', title: 'Templates take any children' },
    Columns({ cols: '55/45', align: 'center' },
      Bullets([
        'Templates are just functions returning DOM',
        'Drop Columns, Grid, Bullets, Card, Code, Image inside',
        'Reveal items step-by-step with { fragment: true }',
      ], { fragment: true }),
      Code(`HeaderSlide({ title: 'Roadmap' },
  Columns({ cols: '65/35' },
    Bullets([...]),
    Card({ title: 'Now' }, ...),
  ),
)`, { lang: 'ts' }),
    ),
  ),

  // 8 — Split: content + full-bleed media
  () => SplitSlide({ ratio: '58/42', side: 'right', media: photo(), kicker: 'Split' },
    h('h2', { class: 'octo-heading' }, 'Text left, media bleeds right'),
    h('p', { class: 'octo-subheading' }, 'The most common pitch-deck layout — any ratio, either side.'),
    Note('SplitSlide({ ratio: "58/42", side: "right", media: Image(...) }, …)'),
  ),

  // 9 — Bento: asymmetric span grid
  () => HeaderSlide({ kicker: 'Bento', title: 'Asymmetric tiles, one grid' },
    Bento({ cols: 4, rows: 2 },
      Tile({ span: 2, rowSpan: 2, accent: true, title: 'Headline tile' },
        h('p', 'Spans 2×2 — the hero cell.')),
      Tile({ span: 2, title: 'Wide' }, Metric({ value: '10×', label: 'faster' })),
      Tile({ title: 'Unit' }, h('p', 'span 1')),
      Tile({ title: 'Unit' }, h('p', 'span 1')),
    ),
  ),

  // 10 — Sequence: horizontal process
  () => HeaderSlide({ kicker: 'Sequence', title: 'Process · horizontal' },
    Sequence({ orientation: 'horizontal' },
      Step({ label: 'Stage 01', title: 'Ideate' }, h('p', 'Frame the problem.')),
      Step({ label: 'Stage 02', title: 'Create' }, h('p', 'Shape the solution.')),
      Step({ label: 'Stage 03', title: 'Deliver' }, h('p', 'Ship and measure.')),
    ),
  ),

  // 11 — Sequence: vertical agenda
  () => HeaderSlide({ kicker: 'Sequence', title: 'Agenda · vertical' },
    Sequence({ orientation: 'vertical' },
      Step({ title: 'The problem' }, h('p', 'Why testing stops the line.')),
      Step({ title: 'The split' }, h('p', 'Plan, build, ship.')),
      Step({ title: 'The payoff' }, h('p', 'The build line never stalls.')),
    ),
  ),

  // 12 — Diagram: deterministic, grid-placed, theme-aware
  () => HeaderSlide({ kicker: 'Diagram', title: 'Diagrams you place, not guess' },
    Diagram({
      cols: 3, rows: 3,
      nodes: {
        client: { at: [0, 1], label: 'Client', shape: 'pill' },
        api:    { at: [1, 1], label: 'API gateway', accent: true },
        db:     { at: [2, 0], label: 'Database' },
        cache:  { at: [2, 1], label: 'Cache' },
        queue:  { at: [2, 2], label: 'Queue' },
      },
      edges: [
        { from: 'client', to: 'api', label: 'HTTPS' },
        { from: 'api', to: 'db', label: 'SQL' },
        { from: 'api', to: 'cache', dashed: true },
        { from: 'api', to: 'queue' },
      ],
    }),
  ),

  // 13 — Quote + logo wall
  () => HeaderSlide({ kicker: 'Quote', title: 'Testimonial & logos' },
    Stack({ gap: '3rem', align: 'start' },
      Quote({ author: 'Stacey Solomon', role: 'Founder, Retail Park' },
        'This method of designing decks is genius. I wish I had known it sooner.'),
      LogoWall([wordmark('Acme'), wordmark('Globex'), wordmark('Initech'), wordmark('Umbrella')]),
    ),
  ),

  // 13 — Statement template (close)
  () => StatementSlide({
    text: 'Pick a template, fill the slots, ship the deck.',
    cite: 'the whole idea',
  }),
]
