# 2026-08-21: Client bundle spike

## Verdict: GREEN

A `@onetest/dsh-deck-canvas` client bundle built entirely outside the
`deepseek-harness` checkout loads and executes through the harness's browser
module table. Task 8 (the canvas UI) proceeds as written.

## Commands run

```sh
# octodeck repo
npm install && npm run build
npm run skill:assets && git diff --stat skills/
npm run skill:validate
npm test --workspace @onetest/dsh-deck-canvas   # RED, then GREEN after Step 7
npm run bundle --workspace @onetest/dsh-deck-canvas

# deepseek-harness repo (DSH_HOME pointed at a scratch directory)
pnpm install
pnpm dsh --profile web --help                       # initializes the profile
pnpm dsh plugin --profile web add \
  file:<octodeck>/packages/dsh-deck-canvas
# hand-edited $DSH_HOME/profiles/web/cordis.patch.yml to insert the plugin row
# (the package declares dsh.client, not dsh.bundle, so `plugin add` installs
# it as a plain dependency and warns; mounting it as a tree entry needs an
# explicit insert row — see "Mounting the plugin" below)
pnpm dsh --profile web --dump-config | grep -A2 dsh-deck-canvas   # confirmed composed
pnpm dsh --profile web --no-open --port 8471        # backgrounded
```

Browser verification via the provided browser tools against
`http://127.0.0.1:8471`.

## Workspace-layout gate (Step 2): initially failed, then fixed

Adding `"workspaces": ["packages/*"]` to root `package.json` made
`npm run skill:assets` leak workspace-only facts into
`skills/octodeck-presentations/assets/template/`, verified in three
isolated `git stash` experiments:

- Fully clean tree, no `workspaces` field: zero diff.
- `workspaces` field alone (no packages/* member yet): the template's
  `package.json` picked up a stray `"workspaces": ["packages/*"]` array, and
  its `package-lock.json` picked up the field on the lockfile's root package
  entry.
- With a real `packages/dsh-deck-canvas` workspace member installed: the
  template's `package-lock.json` additionally picked up a
  `node_modules/@onetest/dsh-deck-canvas` entry with `"link": true` and a
  `packages/dsh-deck-canvas` entry describing that member.

This was reported BLOCKED and escalated. The controller ruled: fix the
generator (`scripts/build-skill-assets.mjs`), not the workspace layout. Fix
applied, extending the script's existing "strip repo-only fields" pattern
(same place it already deletes `skill:assets`/`skill:validate` from the
copied `package.json`):

1. `delete pkg.workspaces` on the copied `package.json`.
2. On the copied `package-lock.json`: delete `packages[''].workspaces`, and
   delete any `packages` map entry whose key starts with `packages/`
   (workspace-member entries) or whose value is `{ link: true, resolved:
   "packages/..." }` (the `node_modules/<name>` symlink entries pointing at
   them) — done by editing the copied JSON in place, not by shelling out to
   `npm install --package-lock-only` (would need registry access).

Verified after the fix, with the real `packages/dsh-deck-canvas` member
installed and its full `devDependencies` (tsdown, vitest, react, etc.)
resolved into the root lockfile:

```
leaked entries: []
root workspaces field: None
```

— no `workspaces` field and no `packages/`/`link:true` entries reached the
template. `npm run build` and `npm run skill:validate` both still pass.

**Residual, disclosed limitation:** the copied `package-lock.json` still
carries lockfile entries for packages that exist *only* because the
workspace member's own `devDependencies` (tsdown, vitest, `@types/react`,
etc.) got installed into the shared root `node_modules` — these are not
`packages/` or `link:true` entries, so the two specified prunes don't touch
them, and a full transitive-reachability prune was judged out of scope (it
would be a nontrivial hand-rolled graph algorithm, and the coordinator
explicitly ruled out the alternative of regenerating the lockfile via a
live `npm install --package-lock-only`, which is the safe way to compute
reachability correctly). Verified this is harmless in practice: unpacking
the generated template into a scratch directory and running `npm install`
there installs only the template's own declared dependencies (`playwright`,
`typescript`, `vite`, `vite-plugin-singlefile` — no `tsdown`, `vitest`, or
`@onetest/dsh-deck-canvas` land in its `node_modules`); npm simply ignores
lockfile entries no dependency in `package.json` reaches. This is dead
weight in the committed template's lockfile size, not a functional defect.

**Also disclosed:** an unrelated, pre-existing staleness fix rides along in
the same lockfile regeneration — the committed template's
`package-lock.json` said `"name": "deckt"` (matching the committed root
lockfile, itself stale relative to root `package.json`'s `"name":
"octodeck"`, present before this task touched anything). Regenerating the
lockfile as part of this fix corrects that drift too; it is orthogonal to
the workspace leak and not something this task introduced.

## Test-writing defect found during Step 7 (new, beyond the pre-flight review)

The pre-flight review already corrected Step 5's third assertion (the
erased `import type` cordis require). A second, previously-uncaught defect
surfaced once the bundle was actually built: `sourcemap: true` (verbatim
from Step 4, and present in the harness's own
`packages/client/tsdown.client.ts` preset) makes rolldown append a trailing
`//# sourceMappingURL=client.js.map` comment after the footer in every
conforming bundle. Verified this is universal, not a spike artifact, by
inspecting several committed harness bundles directly:
`packages/client/ui-tool/lib/client.js`, `ui-layout/lib/client.js`, and
`connection/lib/client.js` all end the same way. Assertion 2 as literally
written (`artifact().trimEnd().endsWith('return module.exports; } });')`)
therefore cannot pass against any real conforming bundle, including the
harness's own shipped ones.

Fix applied: strip the trailing sourcemap comment before checking the
footer, preserving the assertion's stated intent ("closes the factory by
returning the CommonJS exports") rather than its literal wording:

```ts
const withoutSourcemapComment = (source: string): string =>
  source.replace(/\/\/# sourceMappingURL=.*\s*$/, '').trimEnd()
```

This is a same-class correction to the one the pre-flight review already
made for assertion 3 — a demonstrably wrong literal expectation, fixed with
concrete evidence from the real harness's own artifacts — but it was
discovered independently during this task, not pre-authorized, so it is
called out explicitly here for review.

## Step 8: live harness verification

Built `packages/dsh-deck-canvas/lib/client.js` (via `npm run bundle`)
contains no `require("@deepseek-ai/cordis")` (the `import type` import is
erased by TypeScript, as the pre-flight review anticipated) and instead:

```
window.__ModuleLoader__.load({ id: "@onetest/dsh-deck-canvas", factory: (require) => {
"use strict";
var module = { exports: {} }; var exports = module.exports;
...
return module.exports; } });
//# sourceMappingURL=client.js.map
```

### Mounting the plugin

`@onetest/dsh-deck-canvas`'s `package.json` declares `"dsh": { "client": {
"platform": "web" } }` but no `"dsh": { "bundle": ... }`. Installing it with
`pnpm dsh plugin --profile web add file:...` therefore installs it as a
plain dependency only (`dsh: warning: @onetest/dsh-deck-canvas declares no
dsh.bundle — installed as a plain dependency, not a profile layer`) — it
does not automatically join the composed plugin tree. Mounting it as an
actual tree entry needed one explicit `insert` row hand-written into the
profile's own `cordis.patch.yml` (the scratch patch the brief calls for):

```yaml
- insert:
    - id: dsh-deck-canvas-spike
      name: '@onetest/dsh-deck-canvas'
```

Confirmed composed via `pnpm dsh --profile web --dump-config`.

### Result

With the harness's `web` profile booted (`pnpm dsh --profile web --no-open
--port 8471`, `DSH_HOME` pointed at a scratch directory so nothing landed
in the real user's `~/.dsh`) and the browser navigated to
`http://127.0.0.1:8471`:

- Console: `[info] [dsh-deck-canvas] client factory executed`
- DOM: `document.querySelector('[data-dsh-deck-canvas-spike]')` returned
  `<div data-dsh-deck-canvas-spike="loaded" style="display: none;"></div>`
- No console errors of any kind were present (checked with
  `onlyErrors: true`).

No `DEEPSEEK_API_KEY` was configured or needed — the app prompted for one
(expected, for model calls) but the plugin's client factory had already
executed and both markers were already present before that prompt appears.

The harness's dev server (background process) was killed and the browser
tab closed after verification; the scratch `DSH_HOME` was never pointed at
the user's real `~/.dsh`.

## Verdict: GREEN

Task 8 (the canvas UI) proceeds as written per the brief's own verdict
rule. The concrete gaps disclosed above (residual lockfile bloat from
unreachable workspace-member deps; the sourcemap-comment test fix) are
low-risk and fully evidenced, but are flagged for the controller's
attention since they involve judgment calls beyond what was explicitly
pre-authorized.
