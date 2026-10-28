/**
 * TASK-theme-cbo-cap — the theme palette the admin can pick in `UserMenu` (Theme → Primary / Neutral) and the
 * `localStorage` key `plugins/theme-colors.client.ts` remembers the choice under. One list for the menu and
 * for the plugin's allow-list, so a value that is not offered can never be restored.
 */
export const THEME_COLORS_KEY = 'apollo-bo-theme-colors'

export const THEME_PRIMARY_COLORS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'] as const
export const THEME_NEUTRAL_COLORS = ['slate', 'gray', 'zinc', 'neutral', 'stone', 'taupe', 'mauve', 'mist', 'olive'] as const

export interface StoredThemeColors {
  primary?: string
  neutral?: string
}

/** the saved pair, each value only when it is one the menu offers; `{}` on anything unreadable */
export function readThemeColors(): StoredThemeColors {
  try {
    const raw = localStorage.getItem(THEME_COLORS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const { primary, neutral } = parsed as Record<string, unknown>
    return {
      primary: typeof primary === 'string' && (THEME_PRIMARY_COLORS as readonly string[]).includes(primary) ? primary : undefined,
      neutral: typeof neutral === 'string' && (THEME_NEUTRAL_COLORS as readonly string[]).includes(neutral) ? neutral : undefined
    }
  } catch {
    return {}
  }
}

/** never throws — a private window / blocked storage only means the choice does not survive the reload */
export function writeThemeColors(colors: Required<StoredThemeColors>) {
  try {
    localStorage.setItem(THEME_COLORS_KEY, JSON.stringify(colors))
  } catch {
    // nothing to do
  }
}
