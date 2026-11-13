/**
 * FEAT-101 post-merge fix round 2 (B9; spec D18, AC-59, AC-60; api-contract.md v1.9 §3.5) — icons ("glyphs") of Link items
 * and Features items. Pure helpers (explicit imports, no Nuxt auto-imports) so `tests/unit/mssg-glyphs.test.ts` can run them.
 *
 * mssg's glyph: `{ type: "icon", icon }` · `{ type: "emoticon", text }` · `{ type: "image", url }` · `null` = no icon.
 * The icon names are mssg app 6.7.4's picker (two groups, contract §3.5 — the API exports the same list). A glyph read
 * from mssg that Apollo does not know (another type, an icon name not in the list, a known type without its value) is
 * shown as "ไอคอนที่ไม่รู้จัก" and sent back **unchanged** — it is valid only while it deep-equals the glyph read.
 * The local look of an icon (`MSSG_GLYPH_ICON_UI`) is a Lucide / Simple Icons glyph served by the BO itself; nothing
 * is ever loaded from mssg's hosts.
 */

/** contract §3.5 "general" (12) */
export const MSSG_GLYPH_ICONS_GENERAL = [
  'call', 'star', 'bookmark', 'gift', 'dollar', 'download', 'arrow_right', 'arrow_up', 'checkmark', 'shopping_cart', 'help', 'globe'
] as const

/** contract §3.5 "social" (the list has 54 names although the prose says 55 / "67 names" — reported to the Lead; aliases `play, twitter, wa, youtu, t` are not offered) */
export const MSSG_GLYPH_ICONS_SOCIAL = [
  'fivehundredpix', 'bandsintown', 'behance', 'codepen', 'dribbble', 'dropbox', 'email', 'facebook', 'flickr', 'foursquare',
  'github', 'google_play', 'drive', 'google', 'instagram', 'itunes', 'linkedin', 'mailto', 'medium', 'meetup', 'pinterest',
  'reddit', 'rss', 'sharethis', 'smugmug', 'snapchat', 'soundcloud', 'deezer', 'spotify', 'squarespace', 'tumblr', 'twitch',
  'x', 'vimeo', 'vsco', 'wechat', 'whatsapp', 'discord', 'slack', 'line', 'yelp', 'youtube', 'telegram', 'tiktok', 'apps',
  'untappd', 'threads', 'tripadvisor', 'apple', 'podcasts', 'imdb', 'bsky', 'viber', 'messenger'
] as const

export const MSSG_GLYPH_ICONS: readonly string[] = [...MSSG_GLYPH_ICONS_GENERAL, ...MSSG_GLYPH_ICONS_SOCIAL]

/** the BO's own look of each icon name (approximate; Lucide for generic shapes, Simple Icons for brands) */
export const MSSG_GLYPH_ICON_UI: Record<string, string> = {
  call: 'i-lucide-phone',
  star: 'i-lucide-star',
  bookmark: 'i-lucide-bookmark',
  gift: 'i-lucide-gift',
  dollar: 'i-lucide-dollar-sign',
  download: 'i-lucide-download',
  arrow_right: 'i-lucide-arrow-right',
  arrow_up: 'i-lucide-arrow-up',
  checkmark: 'i-lucide-check',
  shopping_cart: 'i-lucide-shopping-cart',
  help: 'i-lucide-circle-help',
  globe: 'i-lucide-globe',
  fivehundredpix: 'i-simple-icons-500px',
  bandsintown: 'i-simple-icons-bandsintown',
  behance: 'i-simple-icons-behance',
  codepen: 'i-simple-icons-codepen',
  dribbble: 'i-simple-icons-dribbble',
  dropbox: 'i-simple-icons-dropbox',
  email: 'i-lucide-mail',
  facebook: 'i-simple-icons-facebook',
  flickr: 'i-simple-icons-flickr',
  foursquare: 'i-simple-icons-foursquare',
  github: 'i-simple-icons-github',
  google_play: 'i-simple-icons-googleplay',
  drive: 'i-simple-icons-googledrive',
  google: 'i-simple-icons-google',
  instagram: 'i-simple-icons-instagram',
  itunes: 'i-simple-icons-itunes',
  linkedin: 'i-simple-icons-linkedin',
  mailto: 'i-lucide-at-sign',
  medium: 'i-simple-icons-medium',
  meetup: 'i-simple-icons-meetup',
  pinterest: 'i-simple-icons-pinterest',
  reddit: 'i-simple-icons-reddit',
  rss: 'i-lucide-rss',
  sharethis: 'i-lucide-share-2',
  smugmug: 'i-simple-icons-smugmug',
  snapchat: 'i-simple-icons-snapchat',
  soundcloud: 'i-simple-icons-soundcloud',
  deezer: 'i-simple-icons-deezer',
  spotify: 'i-simple-icons-spotify',
  squarespace: 'i-simple-icons-squarespace',
  tumblr: 'i-simple-icons-tumblr',
  twitch: 'i-simple-icons-twitch',
  x: 'i-simple-icons-x',
  vimeo: 'i-simple-icons-vimeo',
  vsco: 'i-simple-icons-vsco',
  wechat: 'i-simple-icons-wechat',
  whatsapp: 'i-simple-icons-whatsapp',
  discord: 'i-simple-icons-discord',
  slack: 'i-simple-icons-slack',
  line: 'i-simple-icons-line',
  yelp: 'i-simple-icons-yelp',
  youtube: 'i-simple-icons-youtube',
  telegram: 'i-simple-icons-telegram',
  tiktok: 'i-simple-icons-tiktok',
  apps: 'i-lucide-layout-grid',
  untappd: 'i-simple-icons-untappd',
  threads: 'i-simple-icons-threads',
  tripadvisor: 'i-simple-icons-tripadvisor',
  apple: 'i-simple-icons-apple',
  podcasts: 'i-simple-icons-applepodcasts',
  imdb: 'i-simple-icons-imdb',
  bsky: 'i-simple-icons-bluesky',
  viber: 'i-simple-icons-viber',
  messenger: 'i-simple-icons-messenger'
}

export const MSSG_GLYPH_TEXT = {
  label: 'ไอคอน (Icon)',
  general: 'ไอคอนทั่วไป',
  social: 'ไอคอนโซเชียล',
  emoji: 'อีโมจิ (Emoji)',
  emojiPlaceholder: 'พิมพ์หรือวางอีโมจิ เช่น ⭐',
  emojiApply: 'ใช้อีโมจินี้',
  image: 'รูปไอคอนเอง (Custom image)',
  none: 'ไม่มีไอคอน',
  unknown: 'ไอคอนที่ไม่รู้จัก',
  unknownNote: 'ตั้งไว้บน mssg · Apollo ส่งกลับตามเดิม (เลือกอันอื่นเพื่อเปลี่ยน)',
  change: 'เปลี่ยน'
} as const

export const MSSG_GLYPH_EMOJI_MAX = 16

export type MssgGlyphType = 'icon' | 'emoticon' | 'image' | 'none' | 'unknown'

export interface MssgGlyphInfo {
  type: MssgGlyphType
  /** icon name · emoji text · image url · `''` (none) · the raw icon name / type (unknown) */
  value: string
  /** the BO's icon for a known icon name */
  ui?: string
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b))
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (!isPlain(v)) return v
  return Object.fromEntries(Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => [k, sortKeys(v[k])]))
}

export function mssgIsGlyphIcon(name: unknown): boolean {
  return typeof name === 'string' && MSSG_GLYPH_ICONS.includes(name)
}

/** what the trigger / preview show for a glyph */
export function mssgGlyphInfo(glyph: unknown): MssgGlyphInfo {
  if (glyph === null || glyph === undefined) return { type: 'none', value: '' }
  if (!isPlain(glyph)) return { type: 'unknown', value: String(glyph) }
  const t = glyph.type
  if (t === 'icon') {
    const name = typeof glyph.icon === 'string' ? glyph.icon : ''
    return mssgIsGlyphIcon(name) ? { type: 'icon', value: name, ui: MSSG_GLYPH_ICON_UI[name] } : { type: 'unknown', value: name || 'icon' }
  }
  if (t === 'emoticon') {
    const text = typeof glyph.text === 'string' ? glyph.text : ''
    return text.trim() ? { type: 'emoticon', value: text } : { type: 'unknown', value: 'emoticon' }
  }
  if (t === 'image') {
    const url = typeof glyph.url === 'string' ? glyph.url : ''
    return url ? { type: 'image', value: url } : { type: 'unknown', value: 'image' }
  }
  const raw = typeof glyph.icon === 'string' ? glyph.icon : typeof t === 'string' ? t : ''
  return { type: 'unknown', value: raw || 'glyph' }
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface MssgGlyphRules {
  /** Link: `null` = no icon allowed; Features: a glyph is required */
  allowNone: boolean
  /** Link only: `{ type: "image", url }` */
  allowImage: boolean
}

/** Link items: no icon allowed, image allowed */
export const MSSG_GLYPH_LINK = { allowNone: true, allowImage: true } satisfies MssgGlyphRules

/** Features items: a glyph is required (emoji / icon), no image (mssg's form offers emoji only) */
export const MSSG_GLYPH_FEATURES = { allowNone: false, allowImage: false } satisfies MssgGlyphRules

/**
 * Apollo's rule for one glyph (contract §3.5): `null` (when allowed) · an icon of the 67 names · an emoji 1–16 chars after
 * trim · an image (upload ref or http/https ≤ 2 000, Link only) · **or exactly the glyph read for that item** (`original`;
 * unknown types / names round-trip). Returns the Thai message, or `null` when valid.
 */
export function mssgGlyphIssue(glyph: unknown, original: unknown, rules: MssgGlyphRules): string | null {
  if (original !== undefined && original !== null && deepEqual(glyph, original)) return null
  if (glyph === null || glyph === undefined) return rules.allowNone ? null : 'เลือกไอคอนหรืออีโมจิ'
  if (!isPlain(glyph)) return 'ไอคอนไม่ถูกต้อง · เลือกใหม่'
  switch (glyph.type) {
    case 'icon':
      return mssgIsGlyphIcon(glyph.icon) ? null : 'เลือกไอคอนจากรายการ'
    case 'emoticon': {
      const text = typeof glyph.text === 'string' ? glyph.text.trim() : ''
      if (!text) return 'ใส่อีโมจิ'
      return text.length > MSSG_GLYPH_EMOJI_MAX ? `อีโมจิยาวได้ไม่เกิน ${MSSG_GLYPH_EMOJI_MAX} ตัวอักษร` : null
    }
    case 'image': {
      if (!rules.allowImage) return 'ช่องนี้ใช้รูปเป็นไอคอนไม่ได้ · เลือกอีโมจิหรือไอคอน'
      const url = typeof glyph.url === 'string' ? glyph.url : ''
      if (!url) return 'อัปโหลดรูปไอคอน'
      return /^upload:[a-f0-9]{24}$/i.test(url) || (url.length <= 2000 && isHttpUrl(url)) ? null : 'รูปไอคอนต้องเป็นรูปที่อัปโหลด หรือลิงก์ http(s)'
    }
    default:
      return 'ไอคอนแบบนี้ใช้ไม่ได้ · เลือกใหม่'
  }
}

/** a glyph as sent: emoji trimmed; anything else (incl. an unchanged unknown one) exactly as it is */
export function mssgGlyphOut(glyph: unknown, original: unknown): unknown {
  if (glyph === undefined || glyph === null) return null
  if (original !== undefined && original !== null && deepEqual(glyph, original)) return JSON.parse(JSON.stringify(original))
  if (isPlain(glyph) && glyph.type === 'emoticon' && typeof glyph.text === 'string') return { ...glyph, text: glyph.text.trim() }
  return JSON.parse(JSON.stringify(glyph))
}
