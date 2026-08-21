# 2026-08-21: Client bundle spike — blocked at the workspace gate

## Commands run

```sh
# Step 1
# edited root package.json to add: "workspaces": ["packages/*"]

# Step 2
npm install && npm run build
npm run skill:assets && git diff --stat skills/
```

## Result

`npm install && npm run build` passed with the same output as an unmodified
tree (31 modules transformed, same `dist/` file list).

`npm run skill:assets` then produced a non-empty `git diff --stat skills/`:
adding the `workspaces` field to root `package.json` causes
`scripts/build-skill-assets.mjs` to copy that field verbatim into
`skills/octodeck-presentations/assets/template/package.json`, because the
script's allowlist copies `package.json` wholesale and only strips two
repo-only scripts (`skill:assets`, `skill:validate`); it has no awareness of
a `workspaces` field.

To rule out the effect of unrelated pre-existing uncommitted changes in the
working tree (`vite.config.ts`, `fde.html`, `src/decks/`, all belonging to
the user's in-flight deck and left untouched), the check was repeated in
isolation:

- On the fully clean tree (all uncommitted changes stashed, no `workspaces`
  field): `npm run skill:assets` produced **zero** diff under `skills/`.
- With only the `workspaces` field added back (package.json + regenerated
  package-lock.json, nothing else touched): `npm run skill:assets` produced:

```
 skills/octodeck-presentations/assets/template/package-lock.json | 7 +++++--
 skills/octodeck-presentations/assets/template/package.json      | 3 +++
 2 files changed, 8 insertions(+), 2 deletions(-)
```

with the package.json diff being exactly:

```diff
   "name": "octodeck",
   "version": "0.1.0",
+  "workspaces": [
+    "packages/*"
+  ],
   "description": "...",
```

This isolates the cause to the `workspaces` field itself, not to any
unrelated dirty-tree noise or to `packages/` directory contents being swept
(no `packages/*` package exists yet at this point in the task sequence, and
`packages/` is not in the script's copy allowlist).

## Why this blocks

Every scaffold `npm run new:deck` (or the skill's own onboarding) produces
from `skills/octodeck-presentations/assets/template/` would ship with a
stray `"workspaces": ["packages/*"]` key pointing at a directory that does
not exist in a consumer's scaffolded project. That is a real defect in the
generated artifact the skill template produces for end users, not a
formality — per the pre-flight review's Step 2 gate, this stops the task
here rather than proceeding to build the canvas package skeleton on top of
an unresolved workspace-layout defect.

## Verdict

**BLOCKED at Step 2.** The workspace layout as specified by the brief
(bare `"workspaces": ["packages/*"]` on root `package.json`) is not safe to
land as written: it leaks into the generated skill template via
`scripts/build-skill-assets.mjs`'s unfiltered `package.json` copy. Steps 3-9
(package skeleton, tsdown config, artifact tests, and the live harness
load-verification) were not attempted, per the brief's own ordering and the
pre-flight instruction to stop rather than push through a failed gate.

This is a plan-level question for the controller: either
`build-skill-assets.mjs` needs to strip (or the template needs to tolerate)
a `workspaces` field before the workspace layout can be introduced, or the
workspace/package location needs to live somewhere the asset-copy allowlist
does not reach.

No files under `packages/`, `skills/`, or root `package.json` were left
modified by this spike; the working tree was restored to its pre-task state
(only the user's own pre-existing uncommitted changes to `vite.config.ts`,
`package-lock.json`, `fde.html`, and `src/decks/` remain, untouched).
