import { defineTheme } from '../../framework/theme'

export const octoGlass = defineTheme({
  id: 'octo-glass',
  name: 'Octo · Liquid Glass',
  defaultMode: 'dark',
  load: () => import('./theme.css'),
})
