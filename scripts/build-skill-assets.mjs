// Assemble the self-contained Octodeck project template bundled INSIDE the skill,
// so `npx skills add … --skill octodeck-presentations` ships everything an agent
// needs (framework + scripts + themes + fonts + baked backdrops + theme snapshot).
// Single source of truth = this repo; the template is generated, never hand-edited.
//   npm run skill:assets   → skills/octodeck-presentations/assets/template/
import { cpSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'

const DEST = 'skills/octodeck-presentations/assets/template'
rmSync(DEST, { recursive: true, force: true })
mkdirSync(DEST, { recursive: true })

// allowlist of what a working Octodeck project needs (no node_modules/dist/.git/etc.)
const FILES = [
  'package.json', 'package-lock.json', 'tsconfig.json',
  'vite.config.ts', 'vite.singlefile.config.ts',
  'index.html', 'public', 'src',
]
for (const f of FILES) if (existsSync(f)) cpSync(f, `${DEST}/${f}`, { recursive: true })

// scripts/ — everything EXCEPT this generator and the baked backdrops cache.
// Backdrops (~1MB) are regenerable (`npm run pptx:bake`); pptx export falls back to a
// flat background without them, so they don't belong in the shipped bundle.
const REPO_ONLY = ['build-skill-assets.mjs', 'validate-skill.mjs'] // maintenance scripts; not for consumers
cpSync('scripts', `${DEST}/scripts`, {
  recursive: true,
  filter: (src) => !REPO_ONLY.some((f) => src.endsWith(f)) && !/pptx[\\/]backdrops/.test(src),
})

// drop repo-only fields from the consumer's package.json: the scaffold is a
// standalone project, not a member of this repo's npm workspace.
const pkgPath = `${DEST}/package.json`
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
for (const s of ['skill:assets', 'skill:validate']) delete pkg.scripts[s]
delete pkg.workspaces
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// drop this repo's workspace-member entries from the consumer's package-lock.json:
// `packages/<name>` entries and the `node_modules/<name>` symlink entries that
// resolve into them describe this repo's own layout, not the scaffold's.
const lockPath = `${DEST}/package-lock.json`
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  if (lock.packages?.['']) delete lock.packages[''].workspaces
  for (const [key, entry] of Object.entries(lock.packages ?? {})) {
    const isWorkspaceMember = key.startsWith('packages/')
    const isWorkspaceLink = entry.link === true && typeof entry.resolved === 'string' && entry.resolved.startsWith('packages/')
    if (isWorkspaceMember || isWorkspaceLink) delete lock.packages[key]
  }
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n')
}

// a minimal .gitignore + README for the consumer's copied project
writeFileSync(`${DEST}/.gitignore`, ['node_modules/', 'dist/', 'dist-pptx/', 'dist-pdf/', 'dist-single/', '.vite/', '*.log', '.DS_Store', ''].join('\n'))
writeFileSync(`${DEST}/README.md`, `# Octodeck (project template)

Bundled by the \`octodeck-presentations\` skill. To use:

\`\`\`bash
npm install
npx playwright install chromium      # for capture + pdf/pptx export
npm run dev                          # http://localhost:9001
npm run new:deck -- <name>           # scaffold a deck → /<name>.html
# export:
npm run build:pdf  -- octo-glass --deck <name>
npm run build:pptx -- octo-glass --deck <name>
DECK=<name> npm run build:single
\`\`\`

See the skill's SKILL.md and references/ for the deck-building methodology.
`)

console.log(`built ${DEST}`)
console.log(`  includes: ${FILES.join(', ')}, scripts/ (+ pptx pipeline, embedded fonts, theme snapshot)`)
console.log('  excludes: scripts/pptx/backdrops/ (regenerable via npm run pptx:bake)')
