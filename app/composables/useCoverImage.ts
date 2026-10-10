/**
 * FEAT-042 — the cover of the post a Spark template is bound to (api-contract.md v1 §1.4, §2.3).
 *
 * `GET /backend/ad-templates/:id/cover` answers `{ mimeType, base64 }`; the image is rendered from a data
 * URI, exactly like a build screenshot (`pages/orders/[id].vue`). Two rules the BO must keep:
 * - the request is issued **only** while `postInfo.cover.ok === true` (`enabled`), so a page never produces
 *   an expected 404 — pass `hasPostCover(postInfo)`;
 * - the bytes are cached per **template id + `checkedAt`** in a module-level map, so a table row, the form
 *   modal and the launch-ads card share one request and a re-verify (new `checkedAt`) fetches again.
 *
 * In-flight requests are shared per key as well: 20 rows of the same template, or the modal opening over the
 * table, still cost one request. The states are `loading` → `src`, or `error` (the caller shows a placeholder
 * box; the image is decoration, never an error the user must act on).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdTemplateCover } from '#shared/types/ad-templates'

/** `${templateId}|${checkedAt ?? ''}` → data URI */
const cache = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

/** test/debug helper — the cache lives as long as the page, nothing else clears it */
export function clearCoverCache() {
  cache.clear()
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

  function fetchCover(k: string, id: string): Promise<string | null> {
    const running = inflight.get(k)
    if (running) return running
    // retry: 0 — exactly one request per key
    const promise = api<AdTemplateCover>(`/ad-templates/${encodeURIComponent(id)}/cover`, { retry: 0 })
      .then(res => (res.base64 ? `data:${res.mimeType};base64,${res.base64}` : null))
      .finally(() => {
        inflight.delete(k)
      })
    inflight.set(k, promise)
    return promise
  }

  async function load(k: string) {
    const s = ++session
    const cached = cache.get(k)
    if (cached) {
      src.value = cached
      loading.value = false
      error.value = null
      return
    }
    src.value = null
    error.value = null
    loading.value = true
    try {
      const id = k.slice(0, k.lastIndexOf('|'))
      const url = await fetchCover(k, id)
      if (s !== session) return
      if (url) {
        cache.set(k, url)
        src.value = url
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
      void load(k)
      return
    }
    // nothing to show (no cover stored, or the row disappeared)
    session++
    src.value = null
    loading.value = false
    error.value = null
  }, { immediate: true })

  return { src, loading, error }
}
