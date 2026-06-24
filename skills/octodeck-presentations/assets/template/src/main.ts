import { deck, h } from './framework'
import type { Deck } from './framework'
import { slides } from './slides'
import { themeList } from './themes'
import './app.css'

const d = deck(slides, {
  mount: '#deck',
  hashRouting: true,
  themes: themeList,
  theme: 'midnight',
}).start()

buildSwitcher(d)

/** A small on-screen theme + mode switcher (demo chrome, not part of the framework). */
function buildSwitcher(d: Deck): void {
  const select = h('select', { class: 'sw-select', 'aria-label': 'Theme',
    onChange: (e: Event) => d.setTheme((e.target as HTMLSelectElement).value) },
    ...d.themes.map((id) => h('option', { value: id }, id)))

  const modeBtn = h('button', { class: 'sw-btn', title: 'Toggle light/dark (d)',
    onClick: () => d.toggleMode() }, '◐')

  const bar = h('div', { class: 'sw-bar' }, select, modeBtn)
  document.body.append(bar)

  // Keep the switcher in sync when theme/mode change via keyboard (t / d).
  document.querySelector('.octo-root')?.addEventListener('deckt:themechange', (e) => {
    select.value = (e as CustomEvent).detail.theme
  })
}
