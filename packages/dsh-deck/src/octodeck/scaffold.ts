import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DeckSpec } from '../definition.ts'

/** The seed slides module: valid on first render, and a template for the model. */
function slidesModule(spec: DeckSpec): string {
  return `import { TitleSlide } from 'octodeck/framework'
import type { Slide } from 'octodeck/framework'

export const slides: Slide[] = [
  () => TitleSlide({ title: ${JSON.stringify(spec.title)}, subtitle: 'Edit slides.ts to build this deck' }),
]
`
}

/**
 * Write a deck's own files into the workspace. The framework, the Vite config,
 * and node_modules stay in the plugin package; only deck material lands here.
 * @param spec - the resolved deck.
 * @returns absolute paths written, in write order.
 * @throws {Error} when the deck directory already exists.
 */
export async function scaffoldDeck(spec: DeckSpec): Promise<readonly string[]> {
  const parent = dirname(spec.directory)
  await mkdir(parent, { recursive: true })
  try {
    await mkdir(spec.directory, { recursive: false })
  } catch (cause) {
    throw new Error(`deck ${spec.name} already exists at ${spec.directory}`, { cause })
  }
  const files: Array<readonly [string, string]> = [
    ['deck.json', `${JSON.stringify({ title: spec.title, theme: spec.theme }, null, 2)}\n`],
    ['slides.ts', slidesModule(spec)],
    ['deck.css', `/* Deck-local styles for ${spec.title}. Read the --octo-* contract; never hardcode colors. */\n`],
  ]
  const written: string[] = []
  for (const [name, contents] of files) {
    const path = join(spec.directory, name)
    await writeFile(path, contents, 'utf8')
    written.push(path)
  }
  return written
}
