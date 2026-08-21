import { deck } from 'octodeck/framework'
import { getTheme } from 'octodeck/themes'

const name = window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''
const [{ slides }, meta] = await Promise.all([
  import(/* @vite-ignore */ `/@dsh-deck/${name}/slides.ts`),
  fetch(`/@dsh-deck/${name}/deck.json`).then(async r => r.json() as Promise<{ theme: string }>),
])

deck(slides, {
  mount: '#deck',
  hashRouting: true,
  showProgress: true,
  themes: [getTheme(meta.theme)],
  theme: meta.theme,
}).start()
