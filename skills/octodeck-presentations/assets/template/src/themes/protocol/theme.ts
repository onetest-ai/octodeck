import { defineTheme } from '../../framework/theme'

export const protocol = defineTheme({
  id: 'protocol',
  name: 'Protocol',
  defaultMode: 'dark',
  load: () => import('./theme.css'),
})
