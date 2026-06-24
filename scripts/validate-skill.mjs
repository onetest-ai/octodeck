// Validate skills/octodeck-presentations/SKILL.md against the agentskills.io spec
// (name / description / compatibility rules + name must match the parent dir).
//   npm run skill:validate
import { readFileSync } from 'fs'

const dir = 'skills/octodeck-presentations'
const txt = readFileSync(`${dir}/SKILL.md`, 'utf8')
const fm = txt.match(/^---\n([\s\S]*?)\n---/)
if (!fm) { console.error('✗ SKILL.md has no YAML frontmatter'); process.exit(1) }
const field = (k) => { const r = fm[1].match(new RegExp(`^${k}:\\s*(.*)$`, 'm')); return r ? r[1].trim().replace(/^"|"$/g, '') : null }

const name = field('name'), desc = field('description'), comp = field('compatibility')
const parent = dir.split('/').pop()
const errs = []
if (!name) errs.push('name: missing (required)')
else {
  if (name.length > 64) errs.push(`name: ${name.length} chars (max 64)`)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) errs.push('name: must be lowercase alphanumeric with single hyphens, no leading/trailing/double hyphen')
  if (name !== parent) errs.push(`name "${name}" must match parent dir "${parent}"`)
}
if (!desc) errs.push('description: missing (required)')
else if (desc.length > 1024) errs.push(`description: ${desc.length} chars (max 1024)`)
if (comp && comp.length > 500) errs.push(`compatibility: ${comp.length} chars (max 500)`)

if (errs.length) { console.error('✗ SKILL.md invalid:\n  - ' + errs.join('\n  - ')); process.exit(1) }
console.log(`✓ SKILL.md valid · name=${name} (==dir) · description ${desc.length}/1024${comp ? ` · compatibility ${comp.length}/500` : ''}`)
