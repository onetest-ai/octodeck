import type { DeckOptions, Slide, SlideContext, SlideResult } from './types'
import { applyMode, applyTheme, type Mode, type Theme } from './theme'

/**
 * Deck — the presentation engine.
 *
 * Renders one TS-component slide at a time into a mount node, and owns all the
 * navigation surface: keyboard, swipe, hash routing, progress UI, and "fragment"
 * step-through (any `[data-fragment]` element inside a slide reveals on next()).
 */
export class Deck {
  private readonly slides: Slide[]
  private readonly opts: Required<Omit<DeckOptions, 'theme' | 'mode' | 'themes' | 'width' | 'height'>>
  private readonly root: HTMLElement
  private readonly canvas: HTMLElement
  private readonly stage: HTMLElement
  private readonly counter: HTMLElement
  private readonly bar: HTMLElement
  private readonly canvasW: number
  private readonly canvasH: number

  private current = -1
  /** How many fragments on the current slide are currently revealed. */
  private fragmentStep = 0
  private fragments: HTMLElement[] = []
  /** True when the pending render was reached by navigating backward. */
  private enterBackward = false

  /** Theme registry available to this deck, in declared order. */
  private readonly themeMap = new Map<string, Theme>()
  private readonly themeOrder: string[] = []
  private readonly initialTheme: string | undefined
  private readonly initialMode: Mode | undefined
  private activeTheme = ''
  private activeMode: Mode = 'dark'

  constructor(slides: Slide[], options: DeckOptions = {}) {
    if (slides.length === 0) throw new Error('Deck needs at least one slide.')
    this.slides = slides
    const {
      mount = '#deck', showProgress = true, showProgressBar = true,
      hashRouting = true, touch = true, loop = false,
      themes = [], theme, mode, width = 1280, height = 720,
    } = options
    this.opts = { mount, showProgress, showProgressBar, hashRouting, touch, loop }
    this.canvasW = width
    this.canvasH = height
    for (const t of themes) { this.themeMap.set(t.id, t); this.themeOrder.push(t.id) }
    this.initialTheme = theme
    this.initialMode = mode

    this.root = this.resolveMount(this.opts.mount)
    this.root.classList.add('octo-root')
    this.root.setAttribute('tabindex', '0')

    // A fixed-size design canvas that we scale to fit the window — so every
    // slide keeps its 16:9 proportions and fills the frame at any resolution.
    this.canvas = el('div', 'octo-canvas')
    this.canvas.style.width = `${this.canvasW}px`
    this.canvas.style.height = `${this.canvasH}px`
    this.stage = el('div', 'octo-stage')
    this.bar = el('div', 'octo-progressbar')
    this.counter = el('div', 'octo-counter')

    this.canvas.append(this.stage)
    this.root.replaceChildren(this.canvas)
    if (this.opts.showProgressBar) this.root.append(this.bar)
    if (this.opts.showProgress) this.root.append(this.counter)
  }

  /** Scale the canvas to fit the window while preserving aspect ratio. */
  private readonly fit = (): void => {
    const scale = Math.min(window.innerWidth / this.canvasW, window.innerHeight / this.canvasH)
    this.canvas.style.transform = `translate(-50%, -50%) scale(${scale})`
  }

  /** Wire up listeners and show the first slide (or the one named in the hash). */
  start(): this {
    window.addEventListener('keydown', this.onKey)
    window.addEventListener('resize', this.fit)
    this.fit()
    if (this.opts.hashRouting) window.addEventListener('hashchange', this.onHash)
    if (this.opts.touch) this.bindTouch()

    if (this.themeMap.size) {
      const params = new URLSearchParams(location.search)
      const id = params.get('theme') ?? this.initialTheme ?? this.themeOrder[0]
      const mode = (params.get('mode') as Mode | null) ?? this.initialMode
      void this.setTheme(id, mode ?? undefined)
    }

    const fromHash = this.opts.hashRouting ? this.indexFromHash() : 0
    this.go(fromHash ?? 0)
    this.root.focus()
    return this
  }

  // ── theming ───────────────────────────────────────────────────────────────

  /** Available theme ids, in declared order. */
  get themes(): string[] { return [...this.themeOrder] }
  get theme(): string { return this.activeTheme }
  get mode(): Mode { return this.activeMode }

  /** Switch theme (loads its CSS on first use). Optionally set the mode too. */
  async setTheme(id: string, mode?: Mode): Promise<void> {
    const theme = this.themeMap.get(id) ?? this.themeMap.get(this.themeOrder[0] ?? '')
    if (!theme) return
    this.activeMode = mode ?? this.activeMode ?? theme.defaultMode ?? 'dark'
    // Themed on <html> so seeds cascade into body color/bg and the :root-level
    // derived (color-mix) variables — not just the deck subtree.
    await applyTheme(theme, this.activeMode, document.documentElement)
    this.activeTheme = theme.id
    this.emitThemeChange()
  }

  /** Flip between light and dark on the current theme. */
  toggleMode(): void {
    this.activeMode = this.activeMode === 'dark' ? 'light' : 'dark'
    applyMode(this.activeMode, document.documentElement)
    this.emitThemeChange()
  }

  /** Advance to the next registered theme (keeps the current mode). */
  cycleTheme(): void {
    if (!this.themeOrder.length) return
    const i = this.themeOrder.indexOf(this.activeTheme)
    void this.setTheme(this.themeOrder[(i + 1) % this.themeOrder.length], this.activeMode)
  }

  private emitThemeChange(): void {
    this.root.dispatchEvent(new CustomEvent('deckt:themechange', {
      detail: { theme: this.activeTheme, mode: this.activeMode },
    }))
  }

  /** Tear down global listeners (useful for HMR / embedding). */
  destroy(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('resize', this.fit)
    window.removeEventListener('hashchange', this.onHash)
  }

  // ── navigation ──────────────────────────────────────────────────────────

  go(to: number): void {
    const total = this.slides.length
    let index = to
    if (this.opts.loop) {
      index = ((to % total) + total) % total
    } else {
      index = Math.max(0, Math.min(total - 1, to))
    }
    if (index === this.current) return

    // Entering a slide from a later one (going back) shows it complete —
    // all fragments already revealed, matching how you last left it.
    this.enterBackward = index < this.current
    this.current = index
    this.render()
    if (this.opts.hashRouting) this.writeHash(index)
  }

  /** Advance: reveal the next fragment if any remain, otherwise next slide. */
  next(): void {
    if (this.fragmentStep < this.fragments.length) {
      this.fragments[this.fragmentStep].classList.add('is-visible')
      this.fragmentStep++
      return
    }
    this.go(this.current + 1)
  }

  /** Go back: hide the last fragment if any are shown, otherwise previous slide. */
  prev(): void {
    if (this.fragmentStep > 0) {
      this.fragmentStep--
      this.fragments[this.fragmentStep].classList.remove('is-visible')
      return
    }
    this.go(this.current - 1)
  }

  // ── rendering ───────────────────────────────────────────────────────────

  private render(): void {
    const ctx: SlideContext = {
      index: this.current,
      total: this.slides.length,
      go: (to) => this.go(to),
      next: () => this.next(),
      prev: () => this.prev(),
    }

    const result = this.slides[this.current](ctx)
    const { node, notes, klass } = normalize(result)

    const wrap = el('section', 'octo-slide')
    if (klass) wrap.className += ' ' + klass
    wrap.append(node)

    // Swap with a fade — out with the old, in with the new. Drop any slides
    // still lingering from earlier transitions first, so rapid navigation
    // can never stack more than the outgoing + incoming slide.
    for (const stale of Array.from(this.stage.children)) {
      if (stale.classList.contains('is-leaving')) stale.remove()
    }
    const previous = this.stage.firstElementChild as HTMLElement | null
    this.stage.append(wrap)
    if (previous) {
      previous.classList.add('is-leaving')
      const remove = () => previous.remove()
      previous.addEventListener('transitionend', remove, { once: true })
      setTimeout(remove, 450) // safety net if no transition fires
    }
    requestAnimationFrame(() => wrap.classList.add('is-active'))

    // Reset fragment state for the freshly rendered slide. Arriving backward
    // reveals every fragment; arriving forward starts collapsed.
    this.fragments = Array.from(wrap.querySelectorAll<HTMLElement>('[data-fragment]'))
    if (this.enterBackward) {
      this.fragments.forEach((f) => f.classList.add('is-visible'))
      this.fragmentStep = this.fragments.length
    } else {
      this.fragmentStep = 0
    }

    this.updateChrome()
    if (notes) console.info(`[slide ${this.current + 1} notes] ${notes}`)
  }

  private updateChrome(): void {
    if (this.opts.showProgress) {
      this.counter.textContent = `${this.current + 1} / ${this.slides.length}`
    }
    if (this.opts.showProgressBar) {
      const pct = (this.current / Math.max(1, this.slides.length - 1)) * 100
      this.bar.style.width = `${pct}%`
    }
  }

  // ── input ───────────────────────────────────────────────────────────────

  private readonly onKey = (e: KeyboardEvent): void => {
    switch (e.key) {
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault()
        this.next()
        break
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault()
        this.prev()
        break
      case 'Home':
        e.preventDefault()
        this.go(0)
        break
      case 'End':
        e.preventDefault()
        this.go(this.slides.length - 1)
        break
      case 'f':
        this.toggleFullscreen()
        break
      case 'd':
        if (this.themeMap.size) this.toggleMode()
        break
      case 't':
        if (this.themeMap.size) this.cycleTheme()
        break
    }
  }

  private bindTouch(): void {
    let startX = 0
    let startY = 0
    this.root.addEventListener('touchstart', (e) => {
      startX = e.changedTouches[0].clientX
      startY = e.changedTouches[0].clientY
    }, { passive: true })
    this.root.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - startX
      const dy = e.changedTouches[0].clientY - startY
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        dx < 0 ? this.next() : this.prev()
      }
    }, { passive: true })
  }

  private toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen()
    } else {
      void this.root.requestFullscreen?.()
    }
  }

  // ── hash routing ────────────────────────────────────────────────────────

  private readonly onHash = (): void => {
    const i = this.indexFromHash()
    if (i !== null && i !== this.current) this.go(i)
  }

  private indexFromHash(): number | null {
    const m = location.hash.match(/^#\/(\d+)$/)
    if (!m) return null
    return Math.max(0, Math.min(this.slides.length - 1, Number(m[1]) - 1))
  }

  private writeHash(index: number): void {
    const target = `#/${index + 1}`
    if (location.hash !== target) history.replaceState(null, '', target)
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private resolveMount(mount: string | HTMLElement): HTMLElement {
    if (mount instanceof HTMLElement) return mount
    const found = document.querySelector<HTMLElement>(mount)
    if (!found) throw new Error(`Deck mount "${mount}" not found.`)
    return found
  }
}

function normalize(result: SlideResult): { node: Node; notes?: string; klass?: string } {
  if (result instanceof Node) return { node: result }
  return { node: result.el, notes: result.notes, klass: result.class }
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  return node
}
