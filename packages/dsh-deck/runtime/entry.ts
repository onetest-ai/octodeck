import { deck } from 'octodeck/framework'
import { getTheme } from 'octodeck/themes'

const name = window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''
// Vite serves this module under the dev server's configured `base`
// (`/deck/` here — src/octodeck/vite-server.ts), and the harness webserver
// only routes requests under that same prefix to Vite's middleware. A bare
// `/@dsh-deck/...` path escapes both: it never reaches Vite (404 at the
// harness's own router) and, even inside Vite, only bypasses the base
// because `resolve.alias` and the dev server's base-stripping apply to
// specifiers Vite's own transform/resolution pipeline sees — a dynamic
// `import()` marked `@vite-ignore` was never routed through that pipeline
// with a bare path. `import.meta.env.BASE_URL` is Vite's own resolved
// `base` (verified against src/octodeck/vite-server.ts's
// `base: '${options.base}/'` config), so prefixing with it keeps the
// request inside the mounted route.
const base = import.meta.env.BASE_URL
// `deck.json` is fetched as a module import, not a plain `fetch()`: Vite's
// dev-server transform middleware recognizes `.ts`/`.js` by extension alone,
// but a non-JS-extension file requested outside Vite's own static import
// analysis (this dynamic import is `@vite-ignore`, so Vite never sees or
// rewrites it) needs the explicit `?import` marker to be treated as an ESM
// request through Vite's built-in JSON-to-module transform rather than
// falling through to static file serving, which does not know this
// package's `/@dsh-deck/` alias and 404s (a plain `fetch()` — the form this
// used before — hits exactly that 404). Verified live against a real
// `startPreviewServer` instance: without `?import`, the request is a 404;
// with it, the response is a real ES module exporting `theme` directly.
const [{ slides }, meta] = await Promise.all([
  import(/* @vite-ignore */ `${base}@dsh-deck/${name}/slides.ts`),
  import(/* @vite-ignore */ `${base}@dsh-deck/${name}/deck.json?import`),
])

deck(slides, {
  mount: '#deck',
  hashRouting: true,
  showProgress: true,
  themes: [getTheme(meta.theme)],
  theme: meta.theme,
}).start()
