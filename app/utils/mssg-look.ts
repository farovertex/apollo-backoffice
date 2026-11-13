/**
 * FEAT-101 M3 reopen (B3r; api-contract.md v1.6 §3.4 "Theme preset" / "Font", AC-43, AC-44) — step 3 presets and fonts.
 * Pure helpers (explicit imports) for `tests/unit/mssg-reopen.test.ts`.
 *
 * - A preset is sent as `page.update { theme: { colorId } }` only; `autoTheme` also carries `light` / `dark` (two of the
 *   other 17). Apollo never expands preset colours: the swatches below are **Apollo's own display colours** (K16 — the
 *   real look is mssg's).
 * - A font is `{ family, provider }` from the 38 of the contract, or `null` (= mssg default, key removed on apply).
 */
import type { MssgPageFont, MssgPageTheme } from '../../shared/types/mssg-sites'

export const MSSG_AUTO_THEME = 'autoTheme'

export interface MssgPresetDef {
  id: string
  /** Thai / English display name (Apollo's) */
  th: string
  en: string
  /** display-only swatch: background, text, accent */
  bg: string
  fg: string
  accent: string
}

/** contract §3.4 — the 18 `colorId` values, in the contract's order */
export const MSSG_PRESETS: MssgPresetDef[] = [
  { id: 'newDarkTheme', th: 'มืดใหม่', en: 'New dark', bg: '#16181D', fg: '#F4F4F5', accent: '#7C8BFF' },
  { id: 'newBlueTheme', th: 'ฟ้าใหม่', en: 'New blue', bg: '#E8F0FF', fg: '#13213F', accent: '#2F6BFF' },
  { id: 'newYellowTheme', th: 'เหลืองใหม่', en: 'New yellow', bg: '#FFF6D6', fg: '#3A2E05', accent: '#F2B705' },
  { id: 'newCoralTheme', th: 'ปะการัง', en: 'New coral', bg: '#FFE9E3', fg: '#3D1A12', accent: '#FF6F4F' },
  { id: 'newPurpleTheme', th: 'ม่วงใหม่', en: 'New purple', bg: '#F1EAFF', fg: '#2A1748', accent: '#8B5CF6' },
  { id: 'fireTheme', th: 'ไฟ', en: 'Fire', bg: '#2B0F0A', fg: '#FFE7DC', accent: '#FF5A1F' },
  { id: 'lemonTheme', th: 'มะนาว', en: 'Lemon', bg: '#F7FBD9', fg: '#2F3A06', accent: '#C3D82B' },
  { id: 'skyTheme', th: 'ท้องฟ้า', en: 'Sky', bg: '#E3F4FD', fg: '#0B2E44', accent: '#38A9E0' },
  { id: 'lavenderTheme', th: 'ลาเวนเดอร์', en: 'Lavender', bg: '#F3EEFB', fg: '#33264A', accent: '#A98BD9' },
  { id: 'bubbleGumTheme', th: 'หมากฝรั่ง', en: 'Bubble gum', bg: '#FFE6F2', fg: '#4A1530', accent: '#FF71B5' },
  { id: 'bwTheme', th: 'ขาวดำ', en: 'Black & white', bg: '#FFFFFF', fg: '#111111', accent: '#111111' },
  { id: 'wbTheme', th: 'ดำขาว', en: 'White & black', bg: '#111111', fg: '#FFFFFF', accent: '#FFFFFF' },
  { id: 'lightTheme', th: 'สว่าง', en: 'Light', bg: '#F7F7F8', fg: '#1F2024', accent: '#5B5F6B' },
  { id: 'darkTheme', th: 'มืด', en: 'Dark', bg: '#1F2024', fg: '#EDEDEF', accent: '#9AA0AE' },
  { id: 'strongTheme', th: 'เข้ม', en: 'Strong', bg: '#0E2A47', fg: '#FFFFFF', accent: '#FFC400' },
  { id: 'taxiTheme', th: 'แท็กซี่', en: 'Taxi', bg: '#FFD60A', fg: '#111111', accent: '#111111' },
  { id: 'pinkTheme', th: 'ชมพู', en: 'Pink', bg: '#FFD1E3', fg: '#3F0D23', accent: '#E0457B' },
  { id: MSSG_AUTO_THEME, th: 'อัตโนมัติ สว่าง/มืด', en: 'Auto light / dark', bg: '#F7F7F8', fg: '#1F2024', accent: '#1F2024' }
]

export const MSSG_COLOR_IDS = MSSG_PRESETS.map(p => p.id)
/** the 17 ids `autoTheme` may pair with */
export const MSSG_AUTO_PAIR_IDS = MSSG_COLOR_IDS.filter(id => id !== MSSG_AUTO_THEME)
export const MSSG_AUTO_DEFAULT = { light: 'lightTheme', dark: 'darkTheme' } as const

export function mssgIsColorId(v: unknown): boolean {
  return typeof v === 'string' && MSSG_COLOR_IDS.includes(v)
}

export function mssgPreset(id: unknown): MssgPresetDef | null {
  return MSSG_PRESETS.find(p => p.id === id) ?? null
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

/** the swatch the preview / tiles show for a page theme (`autoTheme` → its light preset), `null` without a preset */
export function mssgThemeSwatch(theme: MssgPageTheme | null | undefined): MssgPresetDef | null {
  const id = theme?.colorId
  if (id === MSSG_AUTO_THEME) return mssgPreset(theme?.light) ?? mssgPreset(MSSG_AUTO_DEFAULT.light)
  return mssgPreset(id)
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
