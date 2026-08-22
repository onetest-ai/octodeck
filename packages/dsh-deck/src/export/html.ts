import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { familiesUsedIn, fontFaceCss, REMOTE_FONT_HOSTS } from './fonts.ts'

/** The framework and theme sources this package vendors, shared with the preview server. */
const VENDORED_SOURCE = new URL('../../vendor/src/', import.meta.url)

/**
 * Each theme's own module and exported binding.
 *
 * Hand-listed so a single-file export can import exactly one theme. The
 * `octodeck/themes` registry cannot serve here: it statically imports all six,
 * which is right for the preview canvas (where any of them can be switched to)
 * and wrong for an export that shows exactly one.
 */
const THEME_MODULES: Record<string, { module: string, binding: string }> = {
  midnight: { module: 'midnight/theme.ts', binding: 'midnight' },
  protocol: { module: 'protocol/theme.ts', binding: 'protocol' },
  primer: { module: 'primer/theme.ts', binding: 'primer' },
  radiant: { module: 'radiant/theme.ts', binding: 'radiant' },
  commit: { module: 'commit/theme.ts', binding: 'commit' },
  'octo-glass': { module: 'octo-glass/theme.ts', binding: 'octoGlass' },
}

/**
 * Build a deck into one self-contained HTML file.
 *
 * The deck's own `runtime/entry.ts` cannot be the build input. It loads slides
 * through `@vite-ignore` dynamic imports, which Rollup deliberately does not
 * follow, so a build over it produces a page that still requests
 * `/@dsh-deck/...` at view time and 404s offline — a file that looks
 * self-contained and is not. This generates an entry that imports the deck's
 * modules *statically*, by absolute path, so the bundler can see them.
 *
 * That also means no `/@dsh-deck/` alias is needed here: `fs.allow` is a
 * dev-server concern, not a build one. Containment stays where the export
 * route already enforces it, on the deck key.
 *
 * Theme and mode come from the caller rather than from `deck.json`, so the
 * export matches whatever the canvas is displaying. Exactly one theme is
 * registered: a single file has no switcher to serve, and registering one
 * keeps a single theme's fonts inlined rather than all six.
 * @param directory - the deck directory.
 * @param theme - the theme id to render in.
 * @param mode - `light` or `dark`.
 * @returns the complete HTML file.
 */
export async function exportHtml(directory: string, theme: string, mode: string): Promise<Buffer> {
  // `realpath` for the same reason the preview server resolves its workspace:
  // on macOS `mkdtemp(tmpdir())` yields `/var/folders/...`, a symlink to
  // `/private/var/folders/...`. Vite resolves the input through the symlink
  // and then derives its emitted name relative to an unresolved `root`,
  // producing a path that escapes the root and fails the build.
  const staging = await realpath(await mkdtemp(join(tmpdir(), 'dsh-deck-html-')))
  try {
    const entry = join(staging, 'entry.ts')
    const page = join(staging, 'index.html')
    const frameworkEntry = fileURLToPath(new URL('framework/index.ts', VENDORED_SOURCE))
    const themesEntry = fileURLToPath(new URL('themes/index.ts', VENDORED_SOURCE))
    const themesDir = fileURLToPath(new URL('themes/', VENDORED_SOURCE))

    const face = THEME_MODULES[theme] ?? THEME_MODULES.midnight
    await writeFile(entry, [
      `import { deck } from ${JSON.stringify(frameworkEntry)}`,
      // The chosen theme is imported from its own module, NOT through the
      // `octodeck/themes` registry. The registry statically imports all six
      // themes, so going through it pulls every theme's stylesheet — and
      // therefore every font family — into a single-file build: an export
      // measured at 3.7MB instead of ~1MB, carrying five stylesheets the
      // deck can never show.
      `import { ${face.binding} as theme } from ${JSON.stringify(join(themesDir, face.module))}`,
      `import { slides } from ${JSON.stringify(join(directory, 'slides.ts'))}`,
      'deck(slides, {',
      "  mount: '#deck',",
      '  hashRouting: true,',
      '  showProgress: true,',
      '  themes: [theme],',
      '  theme: theme.id,',
      `  mode: ${JSON.stringify(mode)},`,
      '}).start()',
      '',
    ].join('\n'), 'utf8')

    await writeFile(page, [
      '<!doctype html>',
      '<html lang="en">',
      '  <head><meta charset="UTF-8" /><title>Deck</title></head>',
      '  <body><div id="deck"></div><script type="module" src="./entry.ts"></script></body>',
      '</html>',
      '',
    ].join('\n'), 'utf8')

    const outDir = join(staging, 'dist')
    await build({
      root: staging,
      // The deck's own CSS lives beside its slides, outside the staging root,
      // so the build has to be allowed to read it.
      configFile: false,
      logLevel: 'silent',
      plugins: [viteSingleFile()],
      resolve: {
        // A scaffolded `slides.ts` imports `octodeck/framework` and
        // `octodeck/themes`. The root package publishes no such subpaths, so
        // the alias — not an exports map — is what makes those specifiers
        // resolve, exactly as the preview server does it. The generated entry
        // above uses absolute paths and needs no alias; the deck's own module
        // does.
        alias: [
          { find: 'octodeck/framework', replacement: frameworkEntry },
          { find: 'octodeck/themes', replacement: themesEntry },
        ],
      },
      build: {
        outDir,
        cssCodeSplit: false,
        assetsInlineLimit: 100_000_000,
        rollupOptions: { input: page },
      },
    })
    return await inlineFonts(await readFile(join(outDir, 'index.html'), 'utf8'))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/**
 * Replace the themes' remote font imports with the bundled faces.
 *
 * Themes `@import` their fonts from three different hosts (Google Fonts,
 * rsms.me, Fontshare). Bundling the markup and scripts but leaving those
 * imports produces a file that *looks* self-contained and silently renders in
 * a substituted face the moment it is opened offline — the one thing this
 * format is for.
 *
 * The faces are read from the package's own vendored TTFs rather than fetched
 * at export time, so the result is deterministic and works with no network.
 * A family that is not bundled (Cabinet Grotesk, which is Fontshare-licensed)
 * degrades: its import is still removed, because leaving it would reintroduce
 * the network dependency for a face that renders as a fallback either way.
 * @param html - the built single-file HTML.
 * @returns the same file with its fonts inlined.
 */
async function inlineFonts(html: string): Promise<Buffer> {
  const { css } = await fontFaceCss(familiesUsedIn(html))
  // Drop every remote font stylesheet import, whatever quoting the bundler
  // emitted (`@import"url"` and `@import url(...)` both occur).
  let out = html.replace(
    /@import\s*(?:url\()?["']?https?:\/\/[^"')]+["']?\)?\s*;?/g,
    (match) => REMOTE_FONT_HOSTS.some(host => match.includes(host)) ? '' : match,
  )
  if (css !== '') {
    // Prepended into <head> so the faces are declared before any rule that
    // uses them, and before the theme stylesheet overrides anything.
    out = out.replace(/<\/head>/i, `<style>${css}</style></head>`)
  }
  return Buffer.from(out, 'utf8')
}
