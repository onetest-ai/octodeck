// Scaffold a new Octodeck deck.
//   npm run new:deck -- <name>        e.g.  npm run new:deck -- product-launch
// Creates src/decks/<name>/{main.ts,slides.ts,<name>.css} + <name>.html and
// registers the deck in vite.config.ts. Then: npm run dev → open /<name>.html
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs'

const name = (process.argv[2] || '').trim()
if (!/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error('✗ usage: npm run new:deck -- <name>   (lowercase, kebab-case, e.g. "q3-review")')
  process.exit(1)
}
const title = name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
const deckDir = `src/decks/${name}`
const htmlPath = `${name}.html`
if (existsSync(deckDir) || existsSync(htmlPath)) {
  console.error(`✗ already exists: ${existsSync(deckDir) ? deckDir : htmlPath} — pick another name`)
  process.exit(1)
}

mkdirSync(deckDir, { recursive: true })

writeFileSync(htmlPath, `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <title>${title}</title>
  </head>
  <body>
    <div id="deck"></div>
    <script type="module" src="/src/decks/${name}/main.ts"></script>
  </body>
</html>
`)

writeFileSync(`${deckDir}/main.ts`, `import { deck } from '../../framework'
import { octoGlass } from '../../themes/octo-glass/theme'
import { slides } from './slides'
import './${name}.css'

deck(slides, {
  mount: '#deck',
  hashRouting: true,
  showProgress: true,
  showProgressBar: true,
  themes: [octoGlass],
  theme: 'octo-glass',
}).start()
`)

writeFileSync(`${deckDir}/slides.ts`, `/**
 * "${title}" — an Octodeck deck. Each slide is a function returning DOM.
 * Edit freely; keep one idea per slide and write titles as the takeaway.
 * See the octodeck-presentations skill for the layout/diagram/QA rules.
 */
import {
  type Slide,
  TitleSlide,
  HeaderSlide,
  StatementSlide,
  Columns,
  Card,
  Bullets,
} from '../../framework'

export const slides: Slide[] = [
  // 1 · Cover
  () =>
    TitleSlide({
      eyebrow: '${title}',
      title: 'One clear idea,\\nstated as a takeaway.',
      subtitle: 'Replace these starter slides with your own.',
    }),

  // 2 · A content slide (title = the assertion)
  () =>
    HeaderSlide(
      { kicker: 'Section', title: 'Make every title the point' },
      Columns(
        { cols: '50/50', align: 'stretch' },
        Card({ title: 'Do' }, Bullets([
          'One idea per slide',
          'Size in cqw / cqh / rem (never vw/vh)',
          'Read the --octo-* contract — never hardcode colours',
        ])),
        Card({ title: 'Avoid', accent: true }, Bullets([
          'Walls of text',
          'Content marooned in dead space',
          'Misaligned cards / chips',
        ])),
      ),
    ),

  // 3 · Closing
  () =>
    StatementSlide({
      text: 'Then export: npm run build:pdf -- octo-glass',
    }),
]
`)

writeFileSync(`${deckDir}/${name}.css`, `/* Deck-local styling for "${title}".
   Reads the --octo-* contract only — no hardcoded colours, so it themes for free. */
`)

// register in vite.config.ts (insert after the stable \`main: 'index.html',\` entry)
const vitePath = 'vite.config.ts'
let vite = readFileSync(vitePath, 'utf8')
// quote the key — kebab-case names aren't valid bare JS identifiers
if (vite.includes(`'${name}': '${htmlPath}'`)) {
  console.warn(`· ${name} already in vite.config.ts input — left as-is`)
} else if (vite.includes(`main: 'index.html',`)) {
  vite = vite.replace(`main: 'index.html',`, `main: 'index.html',\n        '${name}': '${htmlPath}',`)
  writeFileSync(vitePath, vite)
} else {
  console.warn(`· couldn't auto-register in ${vitePath} — add manually:  '${name}': '${htmlPath}'`)
}

console.log(`✓ scaffolded "${title}"
  ${htmlPath}
  ${deckDir}/main.ts · slides.ts · ${name}.css
  registered in vite.config.ts

next:
  npm run dev            → http://localhost:9001/${htmlPath}
  edit ${deckDir}/slides.ts
  npm run build:pdf  -- octo-glass   (or build:pptx / build:single)`)
