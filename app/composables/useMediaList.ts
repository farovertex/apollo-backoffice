/**
 * FEAT-049 — the read half of the media library (api-contract §5.4, spec "Page /media-library").
 * Used by `pages/media-library.vue` (24 per page, pagination) and by `components/media/MediaPicker.vue`
 * (first page only), so "exactly one `GET /media` per trigger" is implemented in exactly one place.
 *
 * Triggers: first `load()` · Refresh · page change · 300 ms-debounced search · after an upload batch ·
 * after a delete · the presigned-URL refresh (silent). A new search goes back to page 1, and because the
 * page watcher and the search watcher collapse into one `queryKey` the two changes still cost one request.
 * `search` is omitted from the query while the box is empty.
 *
 * Presigned-URL refresh: the list keeps **one** timer at the earliest `expiresAt − 60 s` of the items it
 * currently shows and then re-reads the list silently (no skeleton, no scroll reset). An item set whose
 * earliest expiry is already inside the margin is refreshed **once** — a second refresh is only armed when
 * the API answers with a newer expiry, so a stuck/stale API can never spin the page (spec AC-20).
 * `expiresAt: null` (Mongo mode) never arms a timer.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { MediaAssetView, MediaListResponse } from '#shared/types/media'
import { MEDIA_DEBOUNCE_MS, MEDIA_PAGE_SIZE, mediaStaleAt } from '~/utils/media'

export function useMediaList(limit: number = MEDIA_PAGE_SIZE) {
  const api = useApi()

  const page = ref(1)
  const search = ref('')
  const searchDebounced = refDebounced(search, MEDIA_DEBOUNCE_MS)

  const items = ref<MediaAssetView[]>([])
  const total = ref(0)
  const pending = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)

  // bumped on every request so a late response of a superseded query is dropped
  let session = 0
  let staleTimer: ReturnType<typeof setTimeout> | null = null
  /** earliest `expiresAt` we already refreshed for — the same value never triggers a second refresh */
  let refreshedFor: number | null = null

  function clearStaleTimer() {
    if (staleTimer) {
      clearTimeout(staleTimer)
      staleTimer = null
    }
  }

  /** `silent` = a presigned refresh or a post-mutation read: the grid is not dimmed and errors are swallowed */
  async function load(silent = false): Promise<void> {
    const s = ++session
    if (!silent) pending.value = true
    error.value = null
    const q = searchDebounced.value.trim()
    try {
      // retry: 0 — exactly one request per trigger, ofetch must not re-issue it on 5xx
      const res = await api<MediaListResponse>('/media', {
        retry: 0,
        query: { scope: 'public', page: page.value, limit, search: q || undefined }
      })
      if (s !== session) return
      items.value = res.items ?? []
      total.value = res.total ?? items.value.length
      loaded.value = true
    } catch (e) {
      if (s !== session) return
      // a failed silent read must not wipe the grid — Refresh, a search or the next trigger tries again
      if (silent) return
      const err = e as FetchError<Partial<ApiErrorBody>>
      items.value = []
      total.value = 0
      error.value = err.data?.error ?? err.message ?? 'Unexpected error'
    } finally {
      if (!silent && s === session) pending.value = false
    }
  }

  // a new search starts at page 1 — registered before the queryKey watcher so both changes collapse into one request
  watch(searchDebounced, () => {
    page.value = 1
  })

  const queryKey = computed(() => `${page.value}|${searchDebounced.value.trim()}`)
  watch(queryKey, () => {
    void load()
  })

  /** earliest stale moment of the visible items, or `null` when nothing expires (Mongo mode / empty list) */
  const nextStaleAt = computed(() => {
    const stamps = items.value
      .map(item => mediaStaleAt(item.expiresAt))
      .filter((at): at is number => at !== null)
    return stamps.length > 0 ? Math.min(...stamps) : null
  })

  watch(nextStaleAt, (at) => {
    clearStaleTimer()
    if (at === null) return
    // already refreshed for exactly this expiry → the API has nothing newer to give, do not loop
    if (refreshedFor === at) return
    staleTimer = setTimeout(() => {
      refreshedFor = at
      void load(true)
    }, Math.max(0, at - Date.now()))
  }, { immediate: true })

  /** one request after a mutation: through the page watcher when the page really changes, else directly */
  function reload(target?: number, silent = false): void {
    if (target !== undefined && target !== page.value) page.value = target
    else void load(silent)
  }

  /** after an upload batch: the newest image is on page 1 (`-createdAt`) — one request either way */
  function reloadNewest(): void {
    reload(1)
  }

  function clearSearch(): void {
    search.value = ''
  }

  const hasSearch = computed(() => searchDebounced.value.trim() !== '')
  const isEmpty = computed(() => loaded.value && !error.value && total.value === 0)

  /** a deleted card leaves the grid at once; the single re-read right after keeps pagination honest */
  function removeLocally(id: string): void {
    items.value = items.value.filter(item => item.id !== id)
    total.value = Math.max(0, total.value - 1)
  }

  /** a rename is patched into the row in place — no list request (spec "UI behaviour") */
  function patchLocally(asset: MediaAssetView): void {
    const row = items.value.find(item => item.id === asset.id)
    if (row) Object.assign(row, asset)
  }

  onScopeDispose(() => {
    session++
    clearStaleTimer()
  })

  return {
    page,
    search,
    searchDebounced,
    items,
    total,
    pending,
    loaded,
    error,
    hasSearch,
    isEmpty,
    limit,
    load,
    reload,
    reloadNewest,
    clearSearch,
    removeLocally,
    patchLocally
  }
}
