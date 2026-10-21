/**
 * FEAT-042/FEAT-048 — the cover of the post a Spark template is bound to (FEAT-048 api-contract.md v1 §3).
 *
 * `GET /backend/ad-templates/:id/cover` answers either the presigned `{ mimeType, url, expiresAt }` (object
 * storage on, the row migrated) or the legacy `{ mimeType, base64 }` (data URI, exactly like a build
 * screenshot, `pages/orders/[id].vue`). Rules the BO must keep:
 * - the request is issued **only** while `postInfo.cover.ok === true` (`enabled`), so a page never produces
 *   an expected 404 — pass `hasPostCover(postInfo)`;
 * - the bytes/URL are cached per **template id + `checkedAt`** in a module-level map, so a table row, the form
 *   modal and the launch-ads card share one request and a re-verify (new `checkedAt`) fetches again.
 *   **BUG-061**: this only works because `checkedAt` is in the **list** summary as well — while it was served
 *   on the single view only, every list row keyed on `<id>|` and a re-verify could never evict that entry, so
 *   the table kept the cover of the previous post for the whole life of the page (a full reload cleared it);
 * - a cached `url` entry whose `expiresAt` is less than 60 s away counts as missing, so the next consumer of
 *   that key refetches the endpoint instead of handing out a URL that is about to 403.
 *
 * In-flight requests are shared per key as well: 20 rows of the same template, or the modal opening over the
 * table, still cost one request. The states are `loading` → `src`, or `error` (the caller shows a placeholder
 * box; the image is decoration, never an error the user must act on). `retry()` drops the cached entry for the
 * caller's current key and refetches once — the caller (`PostCover.vue`) is the one that guards "at most one
 * automatic retry per key per failure" by only calling `retry()` on the first `<img>` load error.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import { type AdTemplateCover, isAdTemplateCoverUrl } from '#shared/types/ad-templates'

/** a `url` body is treated as stale this long before its real `expiresAt` */
const STALE_MARGIN_MS = 60_000

interface CoverCacheEntry {
  src: string
  /** `null` for a data URI (never expires); epoch ms for a presigned URL */
  expiresAt: number | null
}

/** `${templateId}|${checkedAt ?? ''}` → src + expiry */
const cache = new Map<string, CoverCacheEntry>()
const inflight = new Map<string, Promise<CoverCacheEntry | null>>()

/** test/debug helper — the cache lives as long as the page, nothing else clears it */
export function clearCoverCache() {
  cache.clear()
}

function isFresh(entry: CoverCacheEntry): boolean {
  return entry.expiresAt === null || entry.expiresAt - STALE_MARGIN_MS > Date.now()
}

export function useCoverImage(
  templateId: MaybeRefOrGetter<string | null | undefined>,
  checkedAt: MaybeRefOrGetter<string | null | undefined>,
  enabled: MaybeRefOrGetter<boolean>
) {
  const api = useApi()

  const src = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  // bumped on every key change so a late response of a superseded key is dropped
  let session = 0

  const key = computed(() => {
    const id = toValue(templateId)
    if (!id || !toValue(enabled)) return null
    return `${id}|${toValue(checkedAt) ?? ''}`
  })

  function fetchCover(k: string, id: string): Promise<CoverCacheEntry | null> {
    const running = inflight.get(k)
    if (running) return running
    // retry: 0 — exactly one request per key (per call)
    const promise = api<AdTemplateCover>(`/ad-templates/${encodeURIComponent(id)}/cover`, { retry: 0 })
      .then((res): CoverCacheEntry | null => {
        if (isAdTemplateCoverUrl(res)) {
          return { src: res.url, expiresAt: new Date(res.expiresAt).getTime() }
        }
        return res.base64 ? { src: `data:${res.mimeType};base64,${res.base64}`, expiresAt: null } : null
      })
      .finally(() => {
        inflight.delete(k)
      })
    inflight.set(k, promise)
    return promise
  }

  async function load(k: string, force: boolean) {
    const s = ++session
    if (force) {
      cache.delete(k)
    } else {
      const cached = cache.get(k)
      if (cached && isFresh(cached)) {
        src.value = cached.src
        loading.value = false
        error.value = null
        return
      }
    }
    src.value = null
    error.value = null
    loading.value = true
    try {
      const id = k.slice(0, k.lastIndexOf('|'))
      const entry = await fetchCover(k, id)
      if (s !== session) return
      if (entry) {
        cache.set(k, entry)
        src.value = entry.src
      } else {
        error.value = 'รูปปกว่างเปล่า'
      }
    } catch (e) {
      if (s !== session) return
      const err = e as FetchError<Partial<ApiErrorBody>>
      error.value = err.data?.error ?? err.message ?? 'โหลดรูปปกไม่ได้'
    } finally {
      if (s === session) loading.value = false
    }
  }

  watch(key, (k) => {
    if (k) {
      void load(k, false)
      return
    }
    // nothing to show (no cover stored, or the row disappeared)
    session++
    src.value = null
    loading.value = false
    error.value = null
  }, { immediate: true })

  /** drops the cache entry for the current key and refetches once (caller guards against looping). */
  function retry() {
    const k = key.value
    if (!k) return
    void load(k, true)
  }

  return { src, loading, error, retry }
}
