/**
 * FEAT-049 — pure helpers of the media library (spec "UI behaviour", api-contract §4/§8).
 *
 * Everything here is derived from `GET /media/options` (`maxBytes`, `mimeTypes`, `recommended`): the BO
 * hard-codes no limit and no mime list, so a later change on the API side needs no BO release. The Thai
 * strings the spec pins down ("ไฟล์ใหญ่เกิน 2 MB", "สัดส่วนต่างจาก 750×421") come out of these builders with
 * the current options, byte for byte.
 */
import type { MediaOptions } from '#shared/types/media'

/** a presigned `url` counts as stale this long before its real `expiresAt` (spec "presigned-URL refresh") */
export const MEDIA_STALE_MARGIN_MS = 60_000

/** the grid re-reads the list for a card whose `<img>` failed exactly once, then shows the error state */
export const MEDIA_IMG_MAX_RETRIES = 1

/** ±10 % off the recommended ratio → the non-blocking warning chip */
export const MEDIA_RATIO_TOLERANCE = 0.1

/** list page size (grid of 4 / 3 / 2 columns — spec A8) */
export const MEDIA_PAGE_SIZE = 24

/** search debounce, same as every other list page of the BO */
export const MEDIA_DEBOUNCE_MS = 300

/**
 * Consumer rule of contract §4: the Mongo-mode `url` is API-relative (`/media/<id>/content`) and has to go
 * through the BO's own `/backend` proxy; a storage-mode `url` is an absolute presigned URL on the bucket host
 * and is loaded by the browser as-is.
 */
export function mediaSrc(url: string): string {
  return url.startsWith('/') ? `/backend${url}` : url
}

/** `1.2 MB` · `850 KB` · `2 MB` (a trailing `.0` is dropped so `maxBytes` reads as the spec writes it) */
export function formatMediaBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** `750×421` */
export function formatMediaDimensions(width: number, height: number): string {
  return `${width}×${height}`
}

/** `|w/h − rw/rh| / (rw/rh) > 10 %` — never blocking, only the chip / the upload note */
export function isMediaRatioOff(
  width: number,
  height: number,
  recommended: { width: number, height: number } | null | undefined
): boolean {
  if (!recommended?.width || !recommended.height) return false
  if (!width || !height) return false
  const target = recommended.width / recommended.height
  return Math.abs(width / height - target) / target > MEDIA_RATIO_TOLERANCE
}

/** "สัดส่วนต่างจาก 750×421" */
export function mediaRatioWarning(recommended: { width: number, height: number } | null | undefined): string {
  const size = recommended ? formatMediaDimensions(recommended.width, recommended.height) : ''
  return `สัดส่วนต่างจาก ${size}`
}

const MIME_LABELS: Record<string, string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP'
}

/** `PNG, JPEG, WebP` from `options.mimeTypes` (an unknown type falls back to its subtype in upper case) */
export function mediaMimeLabels(mimeTypes: readonly string[]): string {
  return mimeTypes
    .map(mime => MIME_LABELS[mime] ?? (mime.split('/')[1] ?? mime).toUpperCase())
    .join(', ')
}

/** "รองรับเฉพาะ PNG, JPEG, WebP" (spec upload step 1) */
export function mediaTypeRejected(options: MediaOptions): string {
  return `รองรับเฉพาะ ${mediaMimeLabels(options.mimeTypes)}`
}

/** "ไฟล์ใหญ่เกิน 2 MB" — same text as the API's `MEDIA_MESSAGES.tooLarge`, built from `options.maxBytes` */
export function mediaTooLarge(options: MediaOptions): string {
  return `ไฟล์ใหญ่เกิน ${formatMediaBytes(options.maxBytes)}`
}

/** "ใช้ใน 2 เทมเพลต" */
export function mediaUsedLabel(count: number): string {
  return `ใช้ใน ${count} เทมเพลต`
}

/** "ใช้ใน: Spark A, Spark B" — the delete tooltip, from `usedBy.templates` (no extra request, spec A2) */
export function mediaUsedByTooltip(names: string[]): string {
  return `ใช้ใน: ${names.join(', ')}`
}

/** epoch ms at which a presigned `url` has to be re-read, or `null` when it never expires (Mongo mode) */
export function mediaStaleAt(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null
  const at = new Date(expiresAt).getTime()
  return Number.isNaN(at) ? null : at - MEDIA_STALE_MARGIN_MS
}
