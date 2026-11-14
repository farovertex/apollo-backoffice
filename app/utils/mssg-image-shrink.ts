/**
 * FEAT-101 B10 (spec D19, AC-63..69) — pure rules of the in-browser image shrink before an upload: what to do with a
 * file (send as is / refuse / shrink), the size ladder, the encode order per kind, the output filename and the
 * note text. No DOM and no Nuxt runtime here (unit-tested); the canvas part is `mssg-image-shrink-browser.ts`.
 */

/** `MSSG_UPLOAD_MAX_BYTES` (decoded size the API accepts) */
export const MSSG_SHRINK_LIMIT = 3_145_728
/** inputs above this are refused before decoding, whatever the kind */
export const MSSG_SHRINK_INPUT_MAX = 41_943_040
/** longest side per step, never enlarged */
export const MSSG_SHRINK_STEPS = [2000, 1600, 1280, 1024] as const
export const MSSG_SHRINK_QUALITIES = [0.85, 0.72, 0.6] as const

export const MSSG_SHRINK_TEXT = {
  sizeNoShrink: 'ไฟล์ GIF / ICO ใหญ่เกิน 3 MB · ไฟล์ชนิดนี้ย่อให้อัตโนมัติไม่ได้ ย่อหรือแปลงรูปเองแล้วลองใหม่',
  tooBig: 'ไฟล์ใหญ่เกิน 40 MB · ย่อให้อัตโนมัติไม่ได้ ย่อรูปเองแล้วลองใหม่',
  decodeFailed: 'เปิดรูปนี้ไม่ได้ จึงย่อให้อัตโนมัติไม่ได้ · ไฟล์อาจเสีย ลองบันทึกเป็น JPG หรือ PNG แล้วลองใหม่',
  shrinkFailed: 'ย่อรูปให้เหลือไม่เกิน 3 MB ไม่ได้ · ย่อรูปเองแล้วลองใหม่',
  hint: 'PNG, JPG, WebP, GIF หรือ ICO · ไม่เกิน 3 MB (JPG, PNG, WebP ที่ใหญ่กว่านี้จะย่อให้อัตโนมัติ)',
  shrinking: 'กำลังย่อรูป…'
} as const

export type MssgShrinkKind = 'jpeg' | 'png' | 'webp'
export type MssgShrinkDecision = 'send' | 'sizeNoShrink' | 'tooBig' | 'shrink'

const NO_SHRINK_MIMES = ['image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']

/** the shrinkable kind of a mime (`null` for GIF / ICO / unknown) */
export function mssgShrinkKind(mime: string): MssgShrinkKind | null {
  if (mime === 'image/jpeg') return 'jpeg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return null
}

/** D19 (a)–(d) for a file whose type is already known to be supported and whose size is > 0 */
export function mssgShrinkDecision(mime: string, size: number): MssgShrinkDecision {
  if (size > MSSG_SHRINK_INPUT_MAX) return 'tooBig'
  if (size <= MSSG_SHRINK_LIMIT) return 'send'
  if (NO_SHRINK_MIMES.includes(mime)) return 'sizeNoShrink'
  return mssgShrinkKind(mime) ? 'shrink' : 'sizeNoShrink'
}

/** target size of each step, aspect kept, never enlarged; consecutive identical sizes are dropped */
export function mssgShrinkLadder(width: number, height: number): Array<{ width: number, height: number }> {
  const out: Array<{ width: number, height: number }> = []
  const longest = Math.max(width, height)
  if (!(longest > 0)) return out
  for (const step of MSSG_SHRINK_STEPS) {
    const scale = Math.min(1, step / longest)
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const last = out[out.length - 1]
    if (last && last.width === w && last.height === h) continue
    out.push({ width: w, height: h })
  }
  return out
}

export type MssgShrinkEncode = { type: 'image/jpeg' | 'image/png' | 'image/webp', quality?: number }

/**
 * the encodes tried, in order, at one step. `alpha` = the decoded image has a pixel with alpha < 255 (only matters
 * for PNG: opaque PNG may fall back to JPEG, a transparent one never does). `webpEncodes` = the browser really
 * produced WebP — when it did not, WebP behaves as PNG.
 */
export function mssgShrinkEncodes(kind: MssgShrinkKind, alpha: boolean, webpEncodes = true): MssgShrinkEncode[] {
  const jpeg = MSSG_SHRINK_QUALITIES.map(q => ({ type: 'image/jpeg' as const, quality: q }))
  if (kind === 'jpeg') return jpeg
  if (kind === 'webp' && webpEncodes) return MSSG_SHRINK_QUALITIES.map(q => ({ type: 'image/webp' as const, quality: q }))
  return alpha ? [{ type: 'image/png' }] : [{ type: 'image/png' }, ...jpeg]
}

/** only these blob types may be sent (anything else → `shrinkFailed`) */
export function mssgShrinkMimeOk(type: string): boolean {
  return type === 'image/png' || type === 'image/jpeg' || type === 'image/webp'
}

const MIME_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** original name without its extension (cut so the whole name ≤ 200) + the extension of the sent mime */
export function mssgShrinkFilename(name: string, mime: string): string {
  const ext = MIME_EXT[mime] ?? 'bin'
  const dot = name.lastIndexOf('.')
  let base = dot > 0 ? name.slice(0, dot) : name
  if (!base) base = 'image'
  const max = 200 - ext.length - 1
  if (base.length > max) {
    base = base.slice(0, max)
    // do not leave half of a surrogate pair
    const c = base.charCodeAt(base.length - 1)
    if (c >= 0xD800 && c <= 0xDBFF) base = base.slice(0, -1)
  }
  return `${base}.${ext}`
}

/** MB with one decimal (1 MB = 1 048 576 bytes); below 0.1 MB whole KB */
export function mssgShrinkFormatSize(bytes: number): string {
  if (bytes < 104_858) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1_048_576).toFixed(1)} MB`
}

export type MssgShrunk = {
  fromBytes: number
  toBytes: number
  fromWidth: number
  fromHeight: number
  toWidth: number
  toHeight: number
  mime: string
}

export function mssgShrinkNote(s: MssgShrunk): string {
  return `ย่อรูปให้อัตโนมัติ: ${mssgShrinkFormatSize(s.fromBytes)} → ${mssgShrinkFormatSize(s.toBytes)} (${s.fromWidth}×${s.fromHeight} → ${s.toWidth}×${s.toHeight} px)`
}
