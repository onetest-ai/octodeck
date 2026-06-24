import { defineTheme } from '../../framework/theme'

export const radiant = defineTheme({
  id: 'radiant',
  name: 'Radiant',
  defaultMode: 'light',
  load: () => import('./theme.css'),
})
