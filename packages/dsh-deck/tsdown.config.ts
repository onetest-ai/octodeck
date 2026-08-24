import { defineConfig } from 'tsdown'

/** Module specifiers the harness shell shares through its frozen module table. */
const MODULE_TABLE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

const ID = '@onetest/dsh-deck'
const isShared = (specifier: string): boolean => MODULE_TABLE.has(specifier)

export default defineConfig([
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: isShared,
      alwaysBundle: (specifier: string) => !isShared(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      // One package, one bundle. The harness serves exactly `/plugins/<id>/client.js`
      // (plus its map) and the browser module system's `require` resolves only seed
      // words and boot-graph rows — an emitted chunk is unroutable there, and the
      // `files` glob would not publish it either. So the pptx walker's dynamic import
      // has to land inside the entry rather than becoming a sibling chunk.
      codeSplitting: false,
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
