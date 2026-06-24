import { defineTheme } from '../../framework/theme'

export const primer = defineTheme({
  id: 'primer',
  name: 'Primer',
  defaultMode: 'light',
  load: () => import('./theme.css'),
})
