# Handoff: what a published `@onetest/dsh-deck` loses on install

Investigated 2026-08-24 against a live install: `@onetest/dsh-deck@0.2.1` from npm, DeepSeek Harness `@deepseek-ai/dsh@0.1.1-rc.2`, `dsh-desktop` managed mode, Node 24.15.0, macOS.

**Symptom.** The agent creates a deck and `deck_view` returns correctly — but no canvas appears, and there is no deck-creator agent to pick. From the session log (`session.jsonl`, session `dae362d7`):

```
deck_create  -> "Created deck docs-drift-benchmark; edit .../slides.ts"
deck_view    -> "Deck docs-drift-benchmark: 8 slide(s)"
             meta: { deckId, route: "/deck/L1VzZXJz…/", slideCount: 8, theme: "protocol" }
```

The **host plane is entirely healthy**: tools mount, the preview route serves, `presentationMeta` threads the canonical value onto `meta` exactly as designed. Everything missing is the **browser plane** and the **agent preset**.

Three independent defects. Two belonged to `dsh-desktop`; one was in this repo.

**Resolved 2026-08-24.** `dsh-desktop` has landed A and B, and this package has landed C plus the
`dsh.presets` declaration B needs (unpublished — see the note under B). The findings below are kept
as the record of what was wrong and why, with each fix noted in place.

---

## A. The client half is silently dropped — `dsh-desktop`

### What happens

`dsh-desktop` generates its overlay naming each plugin by its **absolute resolved entry file**
(`~/Library/Application Support/dsh-desktop/runtime/desktop.patch.yml`):

```yaml
- insert:
    - id: onetest-dsh-deck
      name: '/Users/…/.dsh/runtimes/QG9uZXRlc3QvZHNoLWRlY2s/MC4yLjE/node_modules/@onetest/dsh-deck/lib/index.js'
      config: {"base":"/deck"}
```

The harness's `ClientModuleRegistry` (`@deepseek-ai/dsh-client-modules/lib/index.js`) discovers browser bundles by scanning loader entries and resolving **`entry.options.name` as a package specifier**:

```js
const require = createRequire(ctx.baseUrl)          // ctx.baseUrl = $DSH_HOME/profiles/web/cordis.yml
this.resolvePkgJson = (spec) => require.resolve(`${spec}/package.json`)
…
resolveMeta(pkgName) {
  try { pkgPath = this.resolvePkgJson(pkgName) }
  catch { this.pkgMeta.set(pkgName, null); return null }   // ← cached "not a client package", forever
}
```

A path-shaped name cannot resolve, so the package is **cached as "has no client half" and skipped without any diagnostic**. Reproduced verbatim:

```console
$ node -e "require('module').createRequire('/Users/…/.dsh/profiles/web/cordis.yml')
           .resolve('/Users/…/@onetest/dsh-deck/lib/index.js/package.json')"
MODULE_NOT_FOUND: Cannot find module '…/@onetest/dsh-deck/lib/index.js/package.json'
```

Consequence: no `/plugins/@onetest/dsh-deck/client.js` row lands in `window.__DSH_BOOT__`, so neither browser registration in `src/client/index.ts` ever runs — not the `shell.overlay` canvas, and not the `tool.call.toolview` row keyed `deck_view`. The node half is unaffected, which is exactly the observed split.

This is silent by construction. `MissingClientBundleError` and `ClientPackageCompositionError` only fire for a package that *resolved* and then had no built bundle; an unresolvable name never reaches them. The shell's boot screen ("Failed to load plugins") never lights up either.

### The fix, and its current state

Name the insert by **bare package name**, with the package symlinked into the profile's own `node_modules`.

`dsh-desktop` already has this in progress — uncommitted `src/main/plugin-link.ts` plus edits to `plugin-entries.ts`, `runtime-files.ts`, and `index.ts` add `PluginStatus.packageDir`, `ensurePluginLink`/`reconcilePluginLinks` against `$DSH_HOME/profiles/<profile>/node_modules`, and a `resolveName` hook on `writeRuntimeFiles`. **The mechanism is right.** Verified end to end against a symlink replica of the real install:

```console
client-modules resolveMeta OK -> …/@onetest/dsh-deck/package.json
cordis internal.import OK    -> exports: Config,apply,deckViewTool,inject
```

The second line is the cordis loader's *actual* production path — `loader.internal.import(name, ctx.baseUrl, {})` via Node's internal cascaded loader, which is live here because `node-addon-require-builtin` is installed alongside `cordis-plugin-loader` and Node is ≥24. So a bare name resolves for both the loader and the client registry.

**Two things the in-progress work needed before landing — both since done:**

1. **The bare name is load-bearing, not cosmetic.** Every doc comment in `plugin-link.ts` and `runtime-files.ts` frames linking as a nicer display name ("a cosmetic name improvement must never cost the user a working plugin"). It is in fact the *only* way a plugin's browser half is ever discovered. The comments will mislead the next reader into weakening the guarantee.

2. **The path fallback silently half-mounts the plugin.** When `ensurePluginLink` returns `false` — read-only `$DSH_HOME`, a permissions error, a `foreign` entry already occupying the link path — the overlay falls back to the absolute entry path, which reproduces this exact bug: tools work, UI vanishes, nothing is logged. Since `dsh.client` is readable from the package manifest (`pkg.dsh?.client?.platform === 'web'`), a plugin that declares a browser half and could not be linked should be surfaced the way `omitted` entries already are — a tray/Settings warning naming the package, not a silent downgrade.

### How to verify a fix

1. Boot with the plugin configured; confirm the generated `desktop.patch.yml` says `name: '@onetest/dsh-deck'`.
2. `curl -s http://127.0.0.1:<port>/plugins/@onetest/dsh-deck/client.js | head -c 80` → the `window.__ModuleLoader__.load({ id: "@onetest/dsh-deck" …` banner.
3. In the app, `window.__DSH_BOOT__.entries` contains an `@onetest/dsh-deck` row.
4. Create a deck and call `deck_view` — the floating canvas appears and the transcript row is the compact deck row, not the generic tool row.

---

## B. The `deck-creator` agent preset is never installed — `dsh-desktop`

`@onetest/dsh-deck` ships `presets/deck-creator/{preset.yml,agent.cordis.yml}` in the published tarball (confirmed in `npm pack --dry-run`). **Nothing reads it.**

`@deepseek-ai/dsh-agent-presets` discovers presets only from its configured `config.roots` plus the harness-home user root `$DSH_HOME/.agent-presets` (`includeUserRoot`, default true). A plugin cannot add a root by patch, because `apps/cli`'s `composeProfile` appends a **final overlay that replaces `roots` wholesale**:

```js
if (rows.has("agent-presets")) composedOverlays.push({
  id: "agent-presets",
  config: { ...rows.get("agent-presets")?.config ?? {},
            roots: [{ path: SHIPPED_PRESET_ROOT, trust: "system" }] },
})
```

On this machine the shipped root holds `code / cordis / minimal / standard`, and `$DSH_HOME/.agent-presets` **does not exist at all** — which is why the session ran as `"agentPreset":"standard"`.

The registry's authoring API (`AgentPresetRegistry.copy(from, id, name)`) cannot help: it copies from an already-discovered preset, so it cannot introduce one.

**The only working mechanism is copying the preset directory into `$DSH_HOME/.agent-presets/<id>/` at install time.** Suggested shape, generic rather than deck-specific:

- On plugin install (Settings save) and on boot-time reconcile, read the installed package's manifest for a declaration — e.g. `dsh.presets: "./presets"` — and copy each immediate subdirectory containing a `preset.yml` into `$DSH_HOME/.agent-presets/<dirname>/`.
- Treat it like `plugin-link.ts` treats links: never clobber a directory the app did not write (a user's own hand-authored preset of the same id wins), and prune presets belonging to a plugin that was uninstalled.
- The id is the directory name and trust comes from the root, so a copied preset lands as `trust: user` — writable and deletable by the user, which is the correct outcome for something a third-party plugin contributed.

**Landed in `dsh-desktop`** as `src/main/plugin-presets.ts`, with the contract
`dsh.presets: "./presets"` — a string relative to the package root, one directory per preset, each
holding the `preset.yml` that `@deepseek-ai/dsh-agent-presets` requires. Ownership is tracked by a
marker file written inside each copied directory (a copy carries no back-reference the way a symlink
target does), so a hand-authored preset of the same id is never overwritten or pruned.

`@onetest/dsh-deck` declares the field as of **0.2.2**, which is not yet published. Until it is,
`deck-creator` does not install automatically and the manual copy is still the workaround:

```bash
mkdir -p ~/.dsh/.agent-presets
cp -R ~/.dsh/runtimes/QG9uZXRlc3QvZHNoLWRlY2s/*/node_modules/@onetest/dsh-deck/presets/deck-creator \
      ~/.dsh/.agent-presets/
```

Note `deck-creator` composes only the persona and file tools — the deck tools themselves live on the host plane and are already in every session's catalog, so the preset is about model behaviour, not capability. It is not required for the canvas; **A is the blocker, B is the ergonomics.**

---

## C. PPTX export from the canvas was broken — fixed in `octodeck`

`src/client/extract-deck.ts` dynamic-imports `../../vendor/pptx/walker.js`, which tsdown emitted as a sibling chunk `lib/walker-DZrneHeV.cjs`. Two independent breaks:

- the `files` glob was `lib/**/*.js`, so the `.cjs` chunk was **never published**; and
- even present it is unreachable — the harness routes only `/plugins/<id>/client.js` and its `.map`, and the browser module system's `require` resolves only platform seed words and boot-graph rows, so `require("./walker-DZrneHeV.cjs")` throws `"missed the module table"`.

Fixed by `codeSplitting: false` on the client build (`packages/dsh-deck/tsdown.config.ts`) — one package, one bundle, walker inlined; the only remaining requires are the seed words `react` and `react/jsx-runtime`. `lib/client.js.map` was also added to `files`, since the harness serves a source-map route for it. 183 tests pass.

This defect predates publishing: the chunk was equally unresolvable when loaded from a monorepo checkout, so canvas PPTX export has never worked through the harness's module system.

---

## Reading order for whoever picks this up

- `@deepseek-ai/dsh-client-modules/lib/index.js` — `resolveMeta`, `processOne`, `bootInjections`; the whole of finding A is there.
- `@deepseek-ai/dsh/lib/profile-boot-*.js` — `composeProfile`; the `roots` overwrite in finding B.
- `dsh-desktop`: `src/main/runtime-files.ts` (`patchOverlay`, `writeRuntimeFiles`), `src/main/plugin-entries.ts` (`pluginStatus`, `resolvePluginEntry`, `presetsDeclaration`), `src/main/plugin-link.ts` (finding A), `src/main/plugin-presets.ts` (finding B).
- `packages/dsh-deck/src/client/index.ts` — the two registrations that never run today.
- [`2026-08-22-dsh-deck-handoff.md`](2026-08-22-dsh-deck-handoff.md) — the plugin's own state of play.
