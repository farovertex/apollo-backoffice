/**
 * FEAT-049 — the upload half of the media library (spec "Upload flow", api-contract §5.2/§5.3/§8).
 * Shared by `pages/media-library.vue` and `components/media/MediaPicker.vue`, so both behave identically.
 *
 * Per selected file one row with a state machine:
 *   `queued → validating → uploading → confirming → done` · `rejected` (client validation, **no request**) ·
 *   `error` (a request / the direct PUT failed)
 *
 * The client validates first — type against `options.mimeTypes`, size against `options.maxBytes`, then it reads
 * the real pixel size with `createImageBitmap` (fallback: an `Image` on an object URL) because the API trusts
 * the browser's `width`/`height` (brief decision 6). Nothing is hard-coded: every limit and every message comes
 * out of `GET /media/options` through `utils/media.ts`.
 *
 * Two modes, decided by `options.mode` (never guessed):
 * - `storage`: `POST /backend/media/upload-url` → `fetch(url, { method: 'PUT', headers, body: file })` **straight
 *   to the bucket host** (never through `/backend`: the signature covers that host, and the proxy would re-encode
 *   the bytes) → `POST /backend/media { assetId, storageKey, … }`;
 * - `mongo`: `POST /backend/media { data: <base64 without the data-URI prefix>, … }`, one request.
 *
 * Files are processed **sequentially**: a 10-file drop must not open 10 presigned PUTs at once (spec step 4).
 * `options` is cached at module level, so the page and a mounted picker together still issue exactly one
 * `GET /media/options` per page lifetime.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  ConfirmMediaBody,
  ConfirmMediaResponse,
  MediaAssetType,
  MediaAssetView,
  MediaOptions,
  UploadUrlResponse
} from '#shared/types/media'
import { isMediaRatioOff, mediaRatioWarning, mediaRecommendedFor, mediaTooLarge, mediaTypeRejected } from '~/utils/media'

export type MediaUploadState
  = | 'queued'
    | 'validating'
    | 'uploading'
    | 'confirming'
    | 'done'
    | 'rejected'
    | 'error'

export interface MediaUploadItem {
  /** local row id (never the asset id — a rejected file never gets one) */
  uid: string
  filename: string
  state: MediaUploadState
  /** rejection reason, API error text, or the ratio note while `done` */
  message: string | null
  /** the created asset once `done` (the picker selects it) */
  asset: MediaAssetView | null
}

/** `name` longer than this is dropped from the body so the API applies its own truncation (contract §5.3) */
const NAME_MAX = 100

// ── options cache (module level = once per page lifetime, across the page and the picker) ──────────────────────────
let optionsCache: MediaOptions | null = null
let optionsInflight: Promise<MediaOptions> | null = null

/** test/debug helper — the cache lives as long as the loaded app */
export function clearMediaOptionsCache() {
  optionsCache = null
  optionsInflight = null
}

/** API error text: the semantic `{ error }`, else the first zod issue, else ofetch's own message */
function apiMessage(e: unknown, fallback: string): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  return err?.data?.error ?? err?.data?.issues?.[0]?.message ?? err?.message ?? fallback
}

/** real pixel size of the file; throws when the browser cannot decode it */
async function readDimensions(file: File): Promise<{ width: number, height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const size = { width: bitmap.width, height: bitmap.height }
      bitmap.close()
      if (size.width > 0 && size.height > 0) return size
    } catch {
      // some builds refuse WebP/animated images here — the `Image` fallback below decides
    }
  }
  return await new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const size = { width: img.naturalWidth, height: img.naturalHeight }
      URL.revokeObjectURL(objectUrl)
      if (size.width > 0 && size.height > 0) resolve(size)
      else reject(new Error('empty image'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('cannot decode image'))
    }
    img.src = objectUrl
  })
}

/** base64 of the file without the `data:<mime>;base64,` prefix (Mongo mode body) */
async function readBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error ?? new Error('cannot read file'))
    reader.readAsDataURL(file)
  })
  const comma = dataUrl.indexOf(',')
  return comma === -1 ? dataUrl : dataUrl.slice(comma + 1)
}

let uidSeq = 0

export function useMediaUpload() {
  const api = useApi()

  const options = ref<MediaOptions | null>(optionsCache)
  const optionsError = ref<string | null>(null)
  const items = ref<MediaUploadItem[]>([])
  const busy = ref(false)

  /** exactly one `GET /media/options` per page lifetime; every caller awaits the same promise */
  async function loadOptions(): Promise<MediaOptions | null> {
    if (options.value) return options.value
    try {
      // retry: 0 — one request; a failure is shown, never silently retried
      optionsInflight ??= api<MediaOptions>('/media/options', { retry: 0 }).then((res) => {
        optionsCache = res
        return res
      })
      const res = await optionsInflight
      options.value = res
      optionsError.value = null
      return res
    } catch (e) {
      optionsInflight = null
      optionsError.value = apiMessage(e, 'โหลดค่าตั้งคลังรูปไม่ได้')
      return null
    }
  }

  function clear() {
    items.value = []
  }

  function set(uid: string, patch: Partial<MediaUploadItem>) {
    const row = items.value.find(item => item.uid === uid)
    if (row) Object.assign(row, patch)
  }

  /**
   * The non-blocking ratio note shown next to a finished upload (same ±10 % rule as the grid chip) — compared
   * against the recommended size of **that file's type**, which since contract v2 is not the same for both.
   */
  function ratioNote(opts: MediaOptions, assetType: MediaAssetType, width: number, height: number): string | null {
    const size = mediaRecommendedFor(opts.recommended, assetType)
    return isMediaRatioOff(width, height, size) ? mediaRatioWarning(size) : null
  }

  async function uploadOne(uid: string, file: File, opts: MediaOptions, assetType: MediaAssetType): Promise<MediaAssetView | null> {
    // 1. client validation — a rejected file never reaches the API
    set(uid, { state: 'validating' })
    if (!opts.mimeTypes.includes(file.type)) {
      set(uid, { state: 'rejected', message: mediaTypeRejected(opts) })
      return null
    }
    if (file.size > opts.maxBytes) {
      set(uid, { state: 'rejected', message: mediaTooLarge(opts) })
      return null
    }
    let size: { width: number, height: number }
    try {
      size = await readDimensions(file)
    } catch {
      set(uid, { state: 'rejected', message: 'อ่านขนาดรูปไม่ได้' })
      return null
    }

    const name = file.name.trim()
    const body: ConfirmMediaBody = {
      // the API falls back to `originalFilename` (truncated) when `name` is absent — contract §5.3
      ...(name && name.length <= NAME_MAX ? { name } : {}),
      assetType,
      originalFilename: file.name,
      mimeType: file.type,
      bytes: file.size,
      width: size.width,
      height: size.height
    }

    set(uid, { state: 'uploading' })
    if (opts.mode === 'storage') {
      let presigned: UploadUrlResponse
      try {
        // retry: 0 — one presigned URL per file
        presigned = await api<UploadUrlResponse>('/media/upload-url', {
          method: 'POST',
          retry: 0,
          body: { filename: file.name, mimeType: file.type, bytes: file.size }
        })
      } catch (e) {
        set(uid, { state: 'error', message: apiMessage(e, 'ขอ URL อัปโหลดไม่ได้') })
        return null
      }

      let res: Response
      try {
        // direct to the storage host: `headers` are the signed ones, the body is the raw file
        res = await fetch(presigned.url, { method: 'PUT', headers: presigned.headers, body: file })
      } catch {
        // a TypeError here is a network or CORS failure — the bucket's CORS rule is an environment task
        set(uid, { state: 'error', message: 'เบราว์เซอร์ส่งไฟล์ไปยัง storage ไม่ได้ (CORS?)' })
        return null
      }
      if (!res.ok) {
        set(uid, { state: 'error', message: `อัปโหลดไปยัง storage ไม่สำเร็จ (${res.status})` })
        return null
      }

      body.assetId = presigned.assetId
      body.storageKey = presigned.storageKey
    } else {
      try {
        body.data = await readBase64(file)
      } catch {
        set(uid, { state: 'rejected', message: 'อ่านไฟล์ไม่ได้' })
        return null
      }
    }

    set(uid, { state: 'confirming' })
    try {
      // retry: 0 — exactly one confirm per file (a retry could answer 409 alreadyConfirmed)
      const res = await api<ConfirmMediaResponse>('/media', { method: 'POST', retry: 0, body })
      const asset = res.asset
      set(uid, { state: 'done', message: ratioNote(opts, asset.assetType ?? assetType, asset.width, asset.height), asset })
      return asset
    } catch (e) {
      set(uid, { state: 'error', message: apiMessage(e, 'บันทึกรูปไม่สำเร็จ') })
      return null
    }
  }

  /**
   * Queues the selected files and uploads them one after another. Resolves with the assets that were created
   * (the caller re-reads the list once and, in the picker, selects the last one).
   */
  async function uploadFiles(files: File[], assetType: MediaAssetType): Promise<MediaAssetView[]> {
    if (busy.value || files.length === 0) return []
    const opts = options.value ?? await loadOptions()
    const queued = files.map(file => ({
      uid: `u${++uidSeq}`,
      filename: file.name,
      state: 'queued' as MediaUploadState,
      message: null,
      asset: null
    }))
    // one list per selection: the rows always describe the files the user just picked
    items.value = queued
    if (!opts) {
      for (const row of queued) set(row.uid, { state: 'error', message: optionsError.value })
      return []
    }

    busy.value = true
    const created: MediaAssetView[] = []
    try {
      for (const [index, file] of files.entries()) {
        const row = queued[index]
        if (!row) continue
        const asset = await uploadOne(row.uid, file, opts, assetType)
        if (asset) created.push(asset)
      }
    } finally {
      busy.value = false
    }
    return created
  }

  return { options, optionsError, items, busy, loadOptions, uploadFiles, clear }
}
