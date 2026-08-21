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

/**
 * Ancestor `packages` keys to probe for a dependency of `fromKey`, nearest
 * first — the same walk-up-the-tree order Node's own require resolution
 * uses: a package's own nested `node_modules` first, then each enclosing
 * `node_modules` up to the project root (`''`).
 * @param fromKey - the dependent's own lockfile `packages` key (`''` for root).
 * @returns ancestor keys from `fromKey` up to `''`, inclusive.
 */
function ancestorKeys(fromKey) {
  const keys = []
  let cur = fromKey
  while (true) {
    keys.push(cur)
    if (cur === '') break
    const cut = cur.lastIndexOf('/node_modules/')
    cur = cut === -1 ? '' : cur.slice(0, cut)
  }
  return keys
}

/**
 * Resolve a dependency name from a lockfile entry the way Node would:
 * nearest nested `node_modules` first, falling back through ancestors to the
 * hoisted root. Returns `undefined` for an unmet optional/peer dependency
 * (e.g. a platform-specific optional not installed on this machine) — the
 * caller drops it rather than treating it as an error.
 * @param packages - the lockfile's `packages` map.
 * @param fromKey - the dependent's own `packages` key.
 * @param name - the dependency's package name.
 * @returns the resolved `packages` key, or `undefined` if none exists.
 */
function resolveDependency(packages, fromKey, name) {
  for (const ancestor of ancestorKeys(fromKey)) {
    const candidate = ancestor === '' ? `node_modules/${name}` : `${ancestor}/node_modules/${name}`
    if (packages[candidate]) return candidate
  }
  return undefined
}

/**
 * Prune the copied package-lock.json to the closure reachable from the
 * copied package.json's own dependencies, computed offline by walking the
 * lockfile's own dependency graph — never by shelling out to `npm install
 * --package-lock-only`, which needs registry access and would make this
 * generator (and CI) network-dependent. A repo workspace member's own
 * devDependencies (tsdown, vitest, @deepseek-ai/cordis, …) get hoisted into
 * this repo's shared root `node_modules` and recorded in the lockfile, but
 * are structurally unreachable from the scaffold's own package.json — this
 * removes that dead weight along with the workspace member itself. Erring
 * toward keeping an entry (an unresolvable optional/peer dependency, or a
 * resolution quirk this walk doesn't model) is acceptable; dropping a
 * reachable entry is not.
 * @param lock - the parsed package-lock.json.
 * @param scaffoldPkg - the already-stripped copy of package.json (no
 * `workspaces`) whose own dependency sets seed the reachable closure.
 */
function pruneToReachableClosure(lock, scaffoldPkg) {
  const packages = lock.packages ?? {}
  if (packages['']) delete packages[''].workspaces
  const roots = {
    ...scaffoldPkg.dependencies,
    ...scaffoldPkg.devDependencies,
    ...scaffoldPkg.optionalDependencies,
  }
  const reachable = new Set()
  const queue = []
  for (const name of Object.keys(roots)) {
    const key = resolveDependency(packages, '', name)
    if (key !== undefined) queue.push(key)
  }
  while (queue.length > 0) {
    const key = queue.shift()
    if (reachable.has(key)) continue
    reachable.add(key)
    const entry = packages[key]
    const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies }
    for (const name of Object.keys(deps)) {
      const depKey = resolveDependency(packages, key, name)
      if (depKey !== undefined && !reachable.has(depKey)) queue.push(depKey)
    }
  }
  for (const key of Object.keys(packages)) {
    if (key !== '' && !reachable.has(key)) delete packages[key]
  }
}

// prune the consumer's package-lock.json to what its (already
// workspace-stripped) package.json can actually reach.
const lockPath = `${DEST}/package-lock.json`
if (existsSync(lockPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  pruneToReachableClosure(lock, pkg)
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
