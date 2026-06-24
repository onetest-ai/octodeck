// One-shot bootstrap for the bundled Octodeck project. The agent runs this once;
// the user installs nothing. Copies the self-contained template into a workspace
// dir and installs deps. Idempotent (re-running is a no-op once installed).
//   node <skill>/scripts/setup.mjs [dir]            # default ./octodeck — copy + npm install
//   node <skill>/scripts/setup.mjs [dir] --export   # + bundled Chromium FALLBACK (only if no
//                                                   #   system Chrome/Edge; exports auto-use those)
import { cpSync, existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve, join, relative } from 'path'

const here = dirname(fileURLToPath(import.meta.url))            // <skill>/scripts
const template = resolve(here, '..', 'assets', 'template')     // <skill>/assets/template
const args = process.argv.slice(2)
const dirArg = args.find((a) => !a.startsWith('--'))
const target = resolve(dirArg ?? 'octodeck')
const withExport = args.includes('--export')

if (!existsSync(template)) {
  console.error(`✗ bundled template missing at ${template}\n  (is this running from an installed skill? expected <skill>/assets/template)`)
  process.exit(1)
}

const run = (cmd) => execSync(cmd, { cwd: target, stdio: 'inherit' })

if (existsSync(join(target, 'node_modules'))) {
  console.log(`· already set up at ${target} — skipping copy + install`)
} else {
  if (!existsSync(join(target, 'package.json'))) {
    mkdirSync(target, { recursive: true })
    console.log(`· copying Octodeck project → ${target}`)
    cpSync(template, target, { recursive: true })
  }
  console.log('· npm install …')
  run('npm install --no-audit --no-fund')
}

if (withExport) {
  console.log('· installing bundled Chromium (fallback — exports otherwise use your system Chrome/Edge) …')
  run('npx playwright install chromium')
}

const rel = relative(process.cwd(), target) || '.'
console.log(`
✓ Octodeck ready at ${target}
  cd ${rel}
  npm run dev                                  # http://localhost:9001 (live-reloads on edits)
  npm run new:deck -- <name>                   # scaffold a deck → /<name>.html
  npm run build:pptx -- octo-glass --deck <name>   # export (uses your system Chrome/Edge)${withExport ? '' : '\n  (no Chrome/Edge installed? re-run with --export to add a bundled-Chromium fallback)'}`)
