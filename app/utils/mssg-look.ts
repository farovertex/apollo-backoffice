/**
 * FEAT-101 M3 reopen (B3r; api-contract.md v1.6 §3.4 "Theme preset" / "Font", AC-43, AC-44) — step 3 presets and fonts.
 * Pure helpers (explicit imports) for `tests/unit/mssg-reopen.test.ts`.
 *
 * - A preset is sent as `page.update { theme: { colorId } }` only; `autoTheme` also carries `light` / `dark` (two of the
 *   other 17). Apollo does not expand preset colours on the client: the API writes them (v1.11, D21) and the preview
 *   theme carries them. Tile names / colours / plan flags come from the presets route (v1.13, D24 / D25).
 * - A font is `{ family, provider }` from the 38 of the contract, or `null` (= mssg default, key removed on apply).
 */
import type { MssgPageFont, MssgPageTheme, MssgPresetItem, MssgPresetsView } from '../../shared/types/mssg-sites'

export const MSSG_AUTO_THEME = 'autoTheme'

/**
 * contract §3.4 — the 18 `colorId` values, in the contract's order. Ids only: names and colours come from
 * `GET /mssg-sites/:id/presets` (v1.13, D24), the BO holds no colour table.
 */
const MSSG_PRESET_IDS = [
  'newDarkTheme',
  'newBlueTheme',
  'newYellowTheme',
  'newCoralTheme',
  'newPurpleTheme',
  'fireTheme',
  'lemonTheme',
  'skyTheme',
  'lavenderTheme',
  'bubbleGumTheme',
  'bwTheme',
  'wbTheme',
  'lightTheme',
  'darkTheme',
  'strongTheme',
  'taxiTheme',
  'pinkTheme',
  MSSG_AUTO_THEME
]

export const MSSG_COLOR_IDS: string[] = MSSG_PRESET_IDS
/** the 17 ids `autoTheme` may pair with */
export const MSSG_AUTO_PAIR_IDS = MSSG_COLOR_IDS.filter(id => id !== MSSG_AUTO_THEME)
export const MSSG_AUTO_DEFAULT = { light: 'lightTheme', dark: 'darkTheme' } as const

export function mssgIsColorId(v: unknown): boolean {
  return typeof v === 'string' && MSSG_COLOR_IDS.includes(v)
}

/** contract §3.4: an id of the list; `autoTheme` needs `light` + `dark` of the other 17; `light` / `dark` only with it */
export function mssgThemeIssue(t: { colorId?: unknown, light?: unknown, dark?: unknown }): string | null {
  if (!mssgIsColorId(t.colorId)) return 'เลือกธีมจากรายการ'
  const isPair = (v: unknown) => typeof v === 'string' && MSSG_AUTO_PAIR_IDS.includes(v)
  if (t.colorId === MSSG_AUTO_THEME) {
    if (!isPair(t.light)) return 'เลือกธีมตอนสว่าง (light)'
    if (!isPair(t.dark)) return 'เลือกธีมตอนมืด (dark)'
    return null
  }
  return t.light !== undefined || t.dark !== undefined ? 'ธีมนี้ไม่มีคู่สว่าง / มืด' : null
}

/** the `theme` patch of choosing a preset (`autoTheme` carries its pair) */
export function mssgPresetPatch(colorId: string, pair: { light?: string, dark?: string } = {}): MssgPageTheme {
  if (colorId !== MSSG_AUTO_THEME) return { colorId }
  return { colorId, light: pair.light ?? MSSG_AUTO_DEFAULT.light, dark: pair.dark ?? MSSG_AUTO_DEFAULT.dark }
}

// ── fonts ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const MSSG_GOOGLE_FONTS = [
  'Alice', 'Amatic SC', 'Caveat', 'Comfortaa', 'Cormorant', 'IBM Plex Sans', 'Inter', 'Kelly Slab', 'Lobster', 'Manrope',
  'Merriweather', 'Montserrat', 'Montserrat Alternates', 'Noto Sans', 'Noto Serif', 'Open Sans', 'Oswald', 'Pacifico',
  'Pangolin', 'Playfair Display', 'PT Mono', 'PT Sans', 'PT Serif', 'Raleway', 'Roboto Condensed', 'Roboto Slab', 'Roboto',
  'Rubik', 'Russo One', 'Source Code Pro', 'Ubuntu', 'Unbounded'
]
export const MSSG_WEBSAFE_FONTS = ['Arial', 'Comic Sans MS', 'Georgia', 'Helvetica', 'Impact', 'Times New Roman']

export const MSSG_FONTS: MssgPageFont[] = [
  ...MSSG_GOOGLE_FONTS.map(family => ({ family, provider: 'google' as const })),
  ...MSSG_WEBSAFE_FONTS.map(family => ({ family, provider: 'websafe' as const }))
]

/** a family / provider pair of the list (contract §3.4) */
export function mssgFontValid(font: unknown): boolean {
  if (!font || typeof font !== 'object') return false
  const f = font as Record<string, unknown>
  return MSSG_FONTS.some(x => x.family === f.family && x.provider === f.provider)
}

/** the font of a family name (select value), `null` for "ค่าเริ่มต้น" (empty) or a name not in the list */
export function mssgFontByFamily(family: string): MssgPageFont | null {
  return MSSG_FONTS.find(f => f.family === family) ?? null
}

/** CSS `font-family` of a page font for the preview (the browser uses it when it has it; nothing is loaded) */
export function mssgFontCss(font: unknown): string | null {
  if (!mssgFontValid(font)) return null
  const f = font as MssgPageFont
  const generic = /Mono|Code/.test(f.family) ? 'monospace' : /Serif|Merriweather|Playfair|Cormorant|Alice|Georgia|Times|Slab/.test(f.family) && !/Sans/.test(f.family) ? 'serif' : 'sans-serif'
  return `"${f.family}", ${generic}`
}

/**
 * Tiles of step 3 from the presets route answer (D24 / D25). `null` (loading / error): the 18 ids, name = id, no colours,
 * all selectable (no invented colour, never blocks on a guess). `autoTheme` (no swatch) is drawn split from the light /
 * dark tiles' swatches.
 */
export interface MssgPresetTile {
  id: string
  name: string
  allowed: boolean
  /** page background of the tile: the gradient when non-empty, else the plain colour (`null` without data) */
  bg: string | null
  gradient: string
  background: string
  text: string | null
  button: string | null
  buttonText: string | null
  /** `autoTheme`: the two halves (light / dark tile backgrounds) */
  split: { light: string | null, dark: string | null } | null
}

export function mssgTileBackground(sw: { background?: string, backgroundGradient?: string } | null | undefined): string | null {
  if (!sw) return null
  return sw.backgroundGradient ? sw.backgroundGradient : (sw.background || null)
}

export function mssgPresetTiles(view: MssgPresetsView | null | undefined, pair: { light?: string, dark?: string } = {}): MssgPresetTile[] {
  const byId = new Map<string, MssgPresetItem>((view?.items ?? []).map(i => [i.id, i]))
  const order = view?.items?.length ? view.items.map(i => i.id) : MSSG_COLOR_IDS
  return order.map((id) => {
    const it = byId.get(id)
    const sw = it?.swatch ?? null
    const tile: MssgPresetTile = {
      id,
      name: it?.name || id,
      allowed: it ? it.allowed !== false : true,
      bg: mssgTileBackground(sw),
      gradient: sw?.backgroundGradient ?? '',
      background: sw?.background ?? '',
      text: sw?.text ?? null,
      button: sw?.buttonBackground ?? null,
      buttonText: sw?.buttonTextColor ?? null,
      split: null
    }
    if (id === MSSG_AUTO_THEME) {
      tile.split = {
        light: mssgTileBackground(byId.get(pair.light ?? MSSG_AUTO_DEFAULT.light)?.swatch),
        dark: mssgTileBackground(byId.get(pair.dark ?? MSSG_AUTO_DEFAULT.dark)?.swatch)
      }
      const lightSw = byId.get(pair.light ?? MSSG_AUTO_DEFAULT.light)?.swatch
      tile.text = lightSw?.text ?? null
      tile.button = lightSw?.buttonBackground ?? null
      tile.buttonText = lightSw?.buttonTextColor ?? null
    }
    return tile
  })
}

/** ids the plan grants; `null` = no data / unknown role → nothing is restricted */
export function mssgAllowedIds(view: MssgPresetsView | null | undefined): Set<string> | null {
  if (!view?.items?.length || !view.known) return null
  return new Set(view.items.filter(i => i.allowed).map(i => i.id))
}

/** D25 d: a tile can be chosen when the plan grants it (the page's current preset stays shown as selected, but picking it is a no-op anyway) */
export function mssgPresetChoosable(tile: Pick<MssgPresetTile, 'allowed'>): boolean {
  return tile.allowed
}

/**
 * "ใช้กับทุกหน้า" — the `theme` patch copied to every page: background colour + image (B3) and, since v1.6, the preset
 * (`colorId` + `light` / `dark` for `autoTheme`) and the font (`null` = default). A page without a preset copies none.
 */
export function mssgApplyAllTheme(theme: MssgPageTheme | null | undefined): MssgPageTheme {
  const page = theme?.page ?? {}
  const out: MssgPageTheme = {
    page: {
      backgroundColor: typeof page.backgroundColor === 'string' ? page.backgroundColor : null,
      backgroundImage: typeof page.backgroundImage === 'string' && page.backgroundImage ? page.backgroundImage : null,
      font: mssgFontValid(page.font) ? { ...(page.font as MssgPageFont) } : null
    }
  }
  if (mssgIsColorId(theme?.colorId)) Object.assign(out, mssgPresetPatch(theme!.colorId as string, { light: theme?.light as string | undefined, dark: theme?.dark as string | undefined }))
  return out
}

/**
 * D25 d: the apply-all patch for one target page. A preset (or pair member) the plan does not grant is sent only to a page
 * that already has it (read back from mssg); otherwise its keys are left out (`skipped` = true) and the other look keys
 * are still copied. `allowed` = `null`: no restriction.
 */
export function mssgApplyAllThemeFor(
  patch: MssgPageTheme,
  target: MssgPageTheme | null | undefined,
  allowed: Set<string> | null
): { theme: MssgPageTheme, skipped: boolean } {
  const id = patch.colorId
  if (!allowed || typeof id !== 'string' || !id) return { theme: patch, skipped: false }
  const ok = (v: unknown, cur: unknown) => typeof v === 'string' && (allowed.has(v) || cur === v)
  let fine = ok(id, target?.colorId)
  if (fine && id === MSSG_AUTO_THEME) {
    const same = target?.colorId === MSSG_AUTO_THEME
    fine = ok(patch.light, same ? target?.light : undefined) && ok(patch.dark, same ? target?.dark : undefined)
  }
  if (fine) return { theme: patch, skipped: false }
  const theme: MssgPageTheme = { ...patch }
  delete theme.colorId
  delete theme.light
  delete theme.dark
  return { theme, skipped: true }
}
