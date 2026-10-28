/**
 * TASK-theme-cbo-cap — remember the theme colours the admin picks in `UserMenu` (Theme → Primary / Neutral).
 *
 * The menu only writes `appConfig.ui.colors.{primary,neutral}` in memory, so every reload went back to the
 * `app.config.ts` defaults. Light / dark is **not** handled here: `@nuxtjs/color-mode` (through `@nuxt/ui`)
 * already keeps it in `localStorage` (`nuxt-color-mode`).
 *
 * Client only: `localStorage` is per browser, the SSR pass renders the defaults and this plugin restores the
 * saved pair before hydration paints. Values are validated against the menu's own lists (`utils/theme-colors`)
 * and a blocked / missing `localStorage` never throws — the defaults simply stay.
 */
import { readThemeColors, writeThemeColors } from '~/utils/theme-colors'

export default defineNuxtPlugin(() => {
  const appConfig = useAppConfig()

  const stored = readThemeColors()
  if (stored.primary) appConfig.ui.colors.primary = stored.primary
  if (stored.neutral) appConfig.ui.colors.neutral = stored.neutral

  watch(
    () => [appConfig.ui.colors.primary, appConfig.ui.colors.neutral] as const,
    ([primary, neutral]) => writeThemeColors({ primary, neutral })
  )
})
