/**
 * FEAT-101 M2 reopen (B2r; api-contract.md v1.6 §3.4 "Per-block style override", AC-45) — the "รูปแบบ" section of a block
 * form. Pure helpers (explicit imports) for `tests/unit/mssg-reopen.test.ts`.
 *
 * - The editable keys of a kind = the keys of the page's `theme.blocks.<kind in lower camel case>` defaults **as read in
 *   `live`** (a page created in the draft: the live home page's), minus `units`. No defaults → nothing to adjust.
 * - Control per key: name `color` or ending in `Color` → colour (`#RRGGBB` / `#RRGGBBAA`); `linkMode` / `messengersMode` →
 *   select; a number default → number 0–1000; other strings → text ≤ 100; booleans → switch.
 * - The block's override lives in `fields.theme.blocks.<kind>`; a key set to `null` = "ใช้ค่าตามหน้า" (removed by the API).
 *   The form sends only the keys the user touched (`mssgStylePatch`); the draft folds them key by key.
 */
import type { MssgPageProjection, MssgSiteProjection } from '../../shared/types/mssg-sites'

export const MSSG_LINK_MODES = ['classic', 'card', 'grid', 'square', 'tall'] as const
export const MSSG_MESSENGERS_MODES = ['beefy', 'compact', 'list'] as const
export const MSSG_STYLE_COLOR_RE = /^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/

export type MssgStyleControl = 'color' | 'number' | 'mode' | 'text' | 'boolean'

export interface MssgStyleKeyDef {
  key: string
  control: MssgStyleControl
  /** the page's default (shown when the block has no override) */
  default: unknown
  label: string
  /** `mode` only */
  options?: readonly string[]
}

const STYLE_LABEL: Record<string, string> = {
  linkMode: 'รูปแบบปุ่ม (Template)',
  messengersMode: 'รูปแบบปุ่มแชท (Template)',
  backgroundColor: 'สีพื้น',
  color: 'สีตัวอักษร',
  borderColor: 'สีเส้นขอบ',
  width: 'ความกว้าง',
  borderRadius: 'มุมโค้ง',
  borderWidth: 'ความหนาเส้นขอบ',
  gap: 'ระยะห่าง',
  padding: 'ระยะขอบใน'
}

export const MSSG_MODE_LABEL: Record<string, string> = {
  classic: 'Classic', card: 'Card', grid: 'Grid', square: 'Square', tall: 'Tall', beefy: 'Beefy', compact: 'Compact', list: 'List'
}

/** `Link` → `link`, `ImageGallery` → `imageGallery` (the key under `theme.blocks`) */
export function mssgStyleKindKey(kind: string): string {
  return kind ? kind.charAt(0).toLowerCase() + kind.slice(1) : kind
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * The page defaults of `kind` that decide the key set (contract §3.4): the live page's `theme.blocks.<kind>`, or — for a
 * page that is not live (created in the draft) — the live home page's. `null` when there are none.
 */
export function mssgStyleDefaults(live: Pick<MssgSiteProjection, 'pages' | 'homePageId'> | null | undefined, pageId: string, kind: string): Record<string, unknown> | null {
  const pages: MssgPageProjection[] = live?.pages ?? []
  const home = pages.find(p => p.id === live?.homePageId) ?? pages[0]
  // a page created in this draft (temp id) has no defaults of its own on mssg yet
  const page = /^tmp-/.test(pageId) ? home : (pages.find(p => p.id === pageId) ?? home)
  const raw = (page?.theme?.blocks as Record<string, unknown> | undefined)?.[mssgStyleKindKey(kind)]
  if (!isPlain(raw)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'units') out[k] = v
  }
  return Object.keys(out).length ? out : null
}

export function mssgIsColorKey(key: string): boolean {
  return key === 'color' || /Color$/.test(key)
}

/** the controls of the "รูปแบบ" section, in the defaults' key order */
export function mssgStyleKeys(defaults: Record<string, unknown> | null): MssgStyleKeyDef[] {
  if (!defaults) return []
  return Object.entries(defaults).map(([key, def]): MssgStyleKeyDef => {
    const label = STYLE_LABEL[key] ?? key
    if (key === 'linkMode') return { key, control: 'mode', default: def, label, options: MSSG_LINK_MODES }
    if (key === 'messengersMode') return { key, control: 'mode', default: def, label, options: MSSG_MESSENGERS_MODES }
    if (mssgIsColorKey(key)) return { key, control: 'color', default: def, label }
    if (typeof def === 'number') return { key, control: 'number', default: def, label }
    if (typeof def === 'boolean') return { key, control: 'boolean', default: def, label }
    return { key, control: 'text', default: def, label }
  })
}

/** contract §3.4 value rules; `null` = "ใช้ค่าตามหน้า" is always valid. Returns the Thai message or `null`. */
export function mssgStyleValueIssue(def: MssgStyleKeyDef, value: unknown): string | null {
  if (value === null) return null
  switch (def.control) {
    case 'color':
      return typeof value === 'string' && MSSG_STYLE_COLOR_RE.test(value) ? null : 'ใส่สีเป็นรหัส hex เช่น #1A2B3C'
    case 'mode':
      return typeof value === 'string' && (def.options ?? []).includes(value) ? null : `เลือกได้: ${(def.options ?? []).join(', ')}`
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000 ? null : 'ใส่ตัวเลข 0–1000'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'เลือกเปิดหรือปิด'
    default:
      return typeof value === 'string' && value.length <= 100 ? null : 'ยาวได้ไม่เกิน 100 ตัวอักษร'
  }
}

/** the block's current override of its kind (`fields.theme.blocks.<kind>`), without `units` */
export function mssgStyleOverride(fields: Record<string, unknown> | null | undefined, kind: string): Record<string, unknown> {
  const theme = fields?.theme
  const raw = isPlain(theme) && isPlain(theme.blocks) ? theme.blocks[mssgStyleKindKey(kind)] : undefined
  if (!isPlain(raw)) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (k !== 'units' && v !== null && v !== undefined) out[k] = v
  }
  return out
}

/**
 * `fields.theme` of an op for the touched keys: `{ blocks: { <kind>: { key: value | null } } }`. A new block (`create`)
 * carries only the keys that are set (a "use the page's value" on a new block is no override at all). `null` when there
 * is nothing to send.
 */
export function mssgStylePatch(kind: string, touched: Record<string, unknown>, create = false): Record<string, unknown> | null {
  const keys: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(touched)) {
    if (k === 'units' || v === undefined) continue
    if (create && v === null) continue
    keys[k] = v
  }
  if (!Object.keys(keys).length) return null
  return { blocks: { [mssgStyleKindKey(kind)]: keys } }
}

/**
 * Fold a block `fields.theme` patch into an earlier one (draft folding / local preview): key by key under
 * `theme.blocks.<kind>`. `dropNull` removes `null` keys (the preview, a `block.create`), otherwise they are kept so the
 * API removes the override.
 */
export function mssgMergeBlockTheme(prev: unknown, patch: unknown, dropNull: boolean): unknown {
  if (!isPlain(patch)) return patch
  const out: Record<string, unknown> = isPlain(prev) ? JSON.parse(JSON.stringify(prev)) as Record<string, unknown> : {}
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    if (isPlain(v)) {
      out[k] = mssgMergeBlockTheme(out[k], v, dropNull)
    } else if (v === null && dropNull) {
      Reflect.deleteProperty(out, k)
    } else {
      out[k] = JSON.parse(JSON.stringify(v))
    }
  }
  return out
}

/**
 * The preview's approximate CSS of a block override (colours, radius, border, width) and its mode — only the keys the
 * block overrides, so the preview of an untouched block does not change.
 */
export function mssgPreviewStyle(fields: Record<string, unknown>, kind: string): { style: Record<string, string>, mode: string | null } {
  const o = mssgStyleOverride(fields, kind)
  const style: Record<string, string> = {}
  const color = (v: unknown) => (typeof v === 'string' && MSSG_STYLE_COLOR_RE.test(v) ? v : null)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  if (color(o.backgroundColor)) style['background-color'] = color(o.backgroundColor)!
  if (color(o.color)) style.color = color(o.color)!
  if (color(o.borderColor)) style['border-color'] = color(o.borderColor)!
  if (num(o.borderRadius) !== null) style['border-radius'] = `${Math.min(num(o.borderRadius)!, 60)}px`
  if (num(o.borderWidth) !== null) {
    style['border-width'] = `${Math.min(num(o.borderWidth)!, 8)}px`
    style['border-style'] = 'solid'
  }
  if (num(o.width) !== null && num(o.width)! > 0 && num(o.width)! <= 100) style.width = `${num(o.width)}%`
  const mode = typeof o.linkMode === 'string' ? o.linkMode : typeof o.messengersMode === 'string' ? o.messengersMode : null
  return { style, mode }
}
