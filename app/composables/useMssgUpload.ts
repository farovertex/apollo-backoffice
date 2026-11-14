/**
 * FEAT-101 (spec D7, AC-25; api-contract.md v1.3 §3.1) — image uploads of the mssg site editor, reusable by every 🖼
 * field (blocks in M2, favicon / OG / page background in M3, product photos in M4).
 *
 * `upload(file)`: client checks first (mime list, ≤ `MSSG_UPLOAD_MAX_BYTES` = 3 MB decoded) → **no request** when a
 * check fails; a JPEG / PNG / WebP above the limit is shrunk in the browser first (D19, `utils/mssg-image-shrink*.ts`,
 * `shrinking` is true meanwhile, the result carries `shrunk`); a file ≤ the limit is sent byte for byte; then `POST /mssg-sites/:id/uploads { filename, mime, data: <base64> }` through `useApi()` → 201
 * `{ ref: "upload:<id>", previewUrl, … }`. 400 (mime / magic bytes) and 413 (too big, incl. the 4 MiB body limit) →
 * Thai messages. The caller puts `ref` into the draft field.
 *
 * `useMssgImageSrc(siteId, value)`: what an `<img>` shows for a field value — an `upload:<id>` is read through the API
 * client (`GET previewUrl`, auth + area as the site; the proxy injects the session) as a blob → object URL, cached per
 * ref for the page's lifetime; an http(s) URL is used as is; anything else → `null`.
 */
import type { MssgUploadBody, MssgUploadView } from '#shared/types/mssg-sites'
import {
  MSSG_SHRINK_TEXT,
  mssgShrinkDecision,
  mssgShrinkFilename,
  mssgShrinkKind,
  type MssgShrunk
} from '~/utils/mssg-image-shrink'
import { shrinkImageInBrowser } from '~/utils/mssg-image-shrink-browser'

/** contract §3.1 */
export const MSSG_UPLOAD_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon']
/** contract §7 `MSSG_UPLOAD_MAX_BYTES` default (decoded size) */
export const MSSG_UPLOAD_MAX_BYTES = 3_145_728
export const MSSG_UPLOAD_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,.ico,image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon'

export const MSSG_UPLOAD_TEXT = {
  type: 'ไฟล์นี้ไม่ใช่รูปที่รองรับ · ใช้ได้เฉพาะ PNG, JPG, WebP, GIF หรือ ICO',
  /** the server's 413 */
  size: 'ไฟล์ใหญ่เกิน 3 MB · ย่อรูปก่อนแล้วลองใหม่',
  sizeNoShrink: MSSG_SHRINK_TEXT.sizeNoShrink,
  tooBig: MSSG_SHRINK_TEXT.tooBig,
  decodeFailed: MSSG_SHRINK_TEXT.decodeFailed,
  shrinkFailed: MSSG_SHRINK_TEXT.shrinkFailed,
  hint: MSSG_SHRINK_TEXT.hint,
  shrinking: MSSG_SHRINK_TEXT.shrinking,
  badFile: 'ไฟล์นี้ไม่ใช่รูปที่รองรับ หรือไฟล์เสีย (ชนิดไฟล์ไม่ตรงกับเนื้อไฟล์)',
  failed: 'อัปโหลดรูปไม่สำเร็จ ลองใหม่อีกครั้ง',
  notFound: 'ไม่พบเว็บนี้ อาจถูกลบไปแล้ว',
  previewFailed: 'แสดงรูปตัวอย่างไม่ได้'
} as const

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ico: 'image/x-icon'
}

/** the browser leaves `type` empty for some files (.ico) — fall back to the extension */
export function mssgUploadMime(file: Pick<File, 'type' | 'name'>): string {
  if (file.type) return file.type
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXT_MIME[ext] ?? ''
}

/**
 * client check: `null` when the file may be sent (as is, or after the shrink of D19), else the Thai reason (nothing is
 * sent then)
 */
export function mssgUploadCheck(file: Pick<File, 'type' | 'name' | 'size'>): string | null {
  const mime = mssgUploadMime(file)
  if (!MSSG_UPLOAD_MIMES.includes(mime)) return MSSG_UPLOAD_TEXT.type
  if (file.size === 0) return MSSG_UPLOAD_TEXT.badFile
  const d = mssgShrinkDecision(mime, file.size)
  if (d === 'tooBig') return MSSG_UPLOAD_TEXT.tooBig
  if (d === 'sizeNoShrink') return MSSG_UPLOAD_TEXT.sizeNoShrink
  return null
}

function toBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const s = String(reader.result ?? '')
      resolve(s.slice(s.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(file)
  })
}

export type MssgUploadResult = { ok: true, upload: MssgUploadView, shrunk?: MssgShrunk } | { ok: false, message: string }

// ── preview cache (module level: one blob per ref per page lifetime) ───────────────────────────────────────────────
const srcCache = new Map<string, string>()
const srcInflight = new Map<string, Promise<string | null>>()
/** `upload:<id>` → the `previewUrl` the API returned for it (used instead of building the path) */
const previewUrls = new Map<string, string>()

export function useMssgUpload(siteId: MaybeRefOrGetter<string>) {
  const api = useApi()
  /** true while a too-large image is being shrunk (the field shows `กำลังย่อรูป…`) */
  const shrinking = ref(false)

  async function upload(file: File): Promise<MssgUploadResult> {
    const reason = mssgUploadCheck(file)
    if (reason) return { ok: false, message: reason }
    const id = toValue(siteId)
    // what is really sent: the file itself (≤ the limit) or the shrunk blob
    let sent: Blob = file
    let filename = file.name.slice(0, 200)
    let mime = mssgUploadMime(file)
    let shrunk: MssgShrunk | undefined
    const kind = mssgShrinkKind(mime)
    if (kind && mssgShrinkDecision(mime, file.size) === 'shrink') {
      shrinking.value = true
      try {
        const r = await shrinkImageInBrowser(file, kind)
        if (!r.ok) return { ok: false, message: MSSG_UPLOAD_TEXT[r.reason] }
        sent = r.blob
        mime = r.blob.type
        filename = mssgShrinkFilename(file.name, mime)
        shrunk = {
          fromBytes: file.size,
          toBytes: r.blob.size,
          fromWidth: r.fromWidth,
          fromHeight: r.fromHeight,
          toWidth: r.toWidth,
          toHeight: r.toHeight,
          mime
        }
      } finally {
        shrinking.value = false
      }
    }
    let data: string
    try {
      data = await toBase64(sent)
    } catch {
      return { ok: false, message: MSSG_UPLOAD_TEXT.badFile }
    }
    const body: MssgUploadBody = { filename, mime, data }
    try {
      const view = await api<MssgUploadView>(`/mssg-sites/${encodeURIComponent(id)}/uploads`, { method: 'POST', body, retry: 0 })
      previewUrls.set(view.ref, view.previewUrl)
      // the bytes are in hand already: show them without a round trip
      srcCache.set(view.ref, URL.createObjectURL(sent))
      return shrunk ? { ok: true, upload: view, shrunk } : { ok: true, upload: view }
    } catch (e) {
      const f = mssgFailure(e, MSSG_UPLOAD_TEXT.failed)
      if (f.status === 413) return { ok: false, message: MSSG_UPLOAD_TEXT.size }
      if (f.status === 400) return { ok: false, message: MSSG_UPLOAD_TEXT.badFile }
      if (f.status === 404) return { ok: false, message: MSSG_UPLOAD_TEXT.notFound }
      return { ok: false, message: f.status === 403 ? f.message : MSSG_UPLOAD_TEXT.failed }
    }
  }

  return { upload, shrinking }
}

/** an `upload:<id>` ref → its preview path on the API */
function previewPath(siteId: string, ref: string): string {
  return previewUrls.get(ref) ?? `/mssg-sites/${encodeURIComponent(siteId)}/uploads/${encodeURIComponent(ref.slice('upload:'.length))}`
}

export function useMssgImageSrc(siteId: MaybeRefOrGetter<string>, value: MaybeRefOrGetter<string | null | undefined>) {
  const api = useApi()
  const src = ref<string | null>(null)
  const failed = ref(false)

  async function resolve(v: string | null | undefined) {
    failed.value = false
    if (!v) {
      src.value = null
      return
    }
    if (/^https?:\/\//i.test(v) || /^data:image\//i.test(v)) {
      src.value = v
      return
    }
    if (!v.startsWith('upload:')) {
      src.value = null
      return
    }
    const cached = srcCache.get(v)
    if (cached) {
      src.value = cached
      return
    }
    let p = srcInflight.get(v)
    if (!p) {
      p = api<Blob>(previewPath(toValue(siteId), v), { responseType: 'blob', retry: 0 })
        .then((blob) => {
          const url = URL.createObjectURL(blob)
          srcCache.set(v, url)
          return url
        })
        .catch(() => null)
        .finally(() => srcInflight.delete(v))
      srcInflight.set(v, p)
    }
    const url = await p
    if (toValue(value) !== v) return
    src.value = url
    failed.value = !url
  }

  watch(() => toValue(value), v => void resolve(v), { immediate: true })

  return { src, failed }
}
