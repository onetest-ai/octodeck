import { defineTheme } from '../../framework/theme'

export const midnight = defineTheme({
  id: 'midnight',
  name: 'Midnight',
  defaultMode: 'dark',
  load: () => import('./theme.css'),
})
