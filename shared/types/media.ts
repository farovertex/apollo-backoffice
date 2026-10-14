/**
 * FEAT-049 — media library (`คลังรูปกลาง`, scope `public`). Mirrors
 * mission-control/.ai/features/FEAT-049-media-library-public-image-assets/api-contract.md **v1**
 * (§4 view, §5 endpoints, §6 messages, §8 BO consumption).
 *
 * One shared library for every workspace and every role: `mediaAssets.workspaceId` is always `null` in v1,
 * so there is no workspace key anywhere in these types. An image is stored either as a private object in the
 * S3-compatible bucket (`url` = presigned GET, `expiresAt` set) or, on a stack without `STORAGE_*`, as bytes
 * in Mongo (`url` = `/media/<id>/content`, `expiresAt: null`) — which of the two the API runs is answered by
 * `GET /media/options` (`mode`) and decides the upload flow, never a hard-coded assumption in the BO.
 *
 * Consumer rules (contract §4):
 * - image `src` = `url.startsWith('/') ? '/backend' + url : url` → `utils/media.ts#mediaSrc`
 * - a non-null `expiresAt` counts as stale 60 s before it is reached (`MEDIA_STALE_MARGIN_MS`)
 * - `data` and `storageKey` never leave the API; the browser only ever sees `url`.
 */

/** The allow-list is served by `GET /media/options`; this union is only the shape the API can answer with. */
export type MediaMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

/** `storage` = presigned PUT straight to the bucket · `mongo` = base64 in the confirm body */
export type MediaMode = 'storage' | 'mongo'

/** `GET /media/options` 200 (exactly 4 keys) — the only source of the client-side limits */
export interface MediaOptions {
  mode: MediaMode
  maxBytes: number
  mimeTypes: string[]
  recommended: { width: number, height: number }
}

/** `username` is `null` when the admin row is gone (same mapping as `adTemplates.createdBy`) */
export interface MediaUploader {
  id: string
  username: string | null
}

/** One ad template whose display-card add-on references the image (brief B) */
export interface MediaUsedByTemplate {
  id: string
  name: string
  workspaceId: string | null
}

/** `usedBy` is one object on both list and detail (spec A2): the delete tooltip needs no second request */
export interface MediaUsedBy {
  count: number
  templates: MediaUsedByTemplate[]
}

/** `toMediaAssetView()` — exactly 13 keys (contract §4) */
export interface MediaAssetView {
  id: string
  name: string
  originalFilename: string
  mimeType: string
  bytes: number
  width: number
  height: number
  uploadedBy: MediaUploader | null
  /** absolute presigned GET (storage mode) or the API-relative `/media/<id>/content` (Mongo mode) */
  url: string
  /** ISO expiry of the presigned GET · `null` in Mongo mode (never stale) */
  expiresAt: string | null
  usedBy: MediaUsedBy
  createdAt: string
  updatedAt: string
}

/** `GET /media?scope=public&page=&limit=&search=&sort=` 200 */
export interface MediaListResponse {
  items: MediaAssetView[]
  page: number
  limit: number
  total: number
}

/** `POST /media/upload-url` body (storage mode only) */
export interface UploadUrlBody {
  filename: string
  mimeType: string
  bytes: number
}

/** `POST /media/upload-url` 201 — `headers` must be sent verbatim on the browser's PUT (`Content-Type` is signed) */
export interface UploadUrlResponse {
  assetId: string
  storageKey: string
  url: string
  headers: Record<string, string>
  expiresAt: string
}

/**
 * `POST /media` body (confirm / create, one schema for both modes — contract §5.3).
 * storage mode sends `assetId` + `storageKey`, Mongo mode sends `data` (base64 **without** the data-URI prefix);
 * sending the other mode's keys is a 400 (`wrongModeStorage` / `wrongModeMongo`).
 */
export interface ConfirmMediaBody {
  assetId?: string
  storageKey?: string
  data?: string
  name?: string
  originalFilename: string
  mimeType: string
  bytes: number
  width: number
  height: number
}

/** `POST /media` 201 */
export interface ConfirmMediaResponse {
  asset: MediaAssetView
}

/** `GET /media/:id` / `PATCH /media/:id` 200 */
export type MediaAssetResponse = MediaAssetView

/** `PATCH /media/:id` body */
export interface RenameMediaBody {
  name: string
}

/** `DELETE /media/:id` 409 body (contract §5.7) — `error` is the literal `inUse` */
export interface MediaInUseError {
  error: 'inUse'
  templates: MediaUsedByTemplate[]
}

/** What `<MediaPicker @select>` hands to its parent (brief B's call site) */
export interface MediaPickerSelection {
  id: string
  name: string
  url: string
  width: number
  height: number
}
