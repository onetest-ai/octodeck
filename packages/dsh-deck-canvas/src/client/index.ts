import type { Context } from '@deepseek-ai/cordis'

/** Browser half. Spike marker only — replaced by real slot registrations in Task 8. */
export function apply(ctx: Context): void {
  const marker = document.createElement('div')
  marker.dataset.dshDeckCanvasSpike = 'loaded'
  marker.style.display = 'none'
  document.body.appendChild(marker)
  console.info('[dsh-deck-canvas] client factory executed')
  ctx.effect(() => () => { marker.remove() })
}
