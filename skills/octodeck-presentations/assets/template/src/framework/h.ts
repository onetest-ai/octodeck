/**
 * Tiny hyperscript helper for building DOM without JSX tooling.
 *
 *   h('h1', 'Hello')
 *   h('ul', {}, h('li', 'a'), h('li', 'b'))
 *   h('button', { onClick: () => next(), class: 'cta' }, 'Go')
 *
 * It returns a real HTMLElement, so anything DOM-shaped is fair game inside a slide.
 */

export type Child = Node | string | number | false | null | undefined

type Props = {
  class?: string
  style?: string | Partial<CSSStyleDeclaration>
  /** Any `onX` key is wired as an event listener for `x` (lowercased). */
  [key: `on${string}`]: EventListenerOrEventListenerObject | undefined
  /** Any `data-*` / `aria-*` / plain attribute. */
  [key: string]: unknown
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Props | Child,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)

  // Allow `h('h1', 'text')` — second arg is a child, not props.
  if (isChild(props)) {
    children.unshift(props)
  } else if (props) {
    applyProps(el, props)
  }

  for (const child of children.flat(Infinity as 1)) {
    if (child === false || child === null || child === undefined) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }

  return el
}

function isChild(v: Props | Child): v is Child {
  return (
    v instanceof Node ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    v === false ||
    v === null ||
    v === undefined
  )
}

function applyProps(el: HTMLElement, props: Props): void {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue

    if (key === 'class') {
      el.className = String(value)
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value)
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
    } else {
      el.setAttribute(key, value === true ? '' : String(value))
    }
  }
}

/** Build a DOM fragment from an HTML string — handy for slides that paste markup. */
export function raw(html: string): DocumentFragment {
  return document.createRange().createContextualFragment(html)
}
