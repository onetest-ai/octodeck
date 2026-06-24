import { defineTheme } from '../../framework/theme'

export const commit = defineTheme({
  id: 'commit',
  name: 'Commit',
  defaultMode: 'dark',
  load: () => import('./theme.css'),
})
