import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { TopupLiveMode, TopupView, TopupsResponse } from '#shared/types/topups'

/** the page re-reads the active list every 10 s while the stream is down (AC-18, v1.1 §B) */
export const TOPUP_POLL_MS = 10_000
/** …and tries the stream again every 30 s */
export const TOPUP_RECONNECT_MS = 30_000
/** `GET /topups` caps `limit` at 100 (api-contract §4); the active list is never longer in practice (L-5) */
export const TOPUP_ACTIVE_LIMIT = 100

export interface UseTopupsLiveOptions {
  /** restrict the stream and the list to one workspace (GOD / Payment filter) */
  workspaceId?: MaybeRefOrGetter<string | undefined>
  /**
   * every `topup` event, **including the ones that end a round** (`active: false`) — the advertisers
   * slide-over patches its own rows from this, the `/topups` table only needs `rows`.
   */
  onTopup?: (topup: TopupView) => void
  /** start the stream right away (default: the caller calls `start()`, e.g. when a slide-over opens) */
  immediate?: boolean
}

/**
 * FEAT-021 (AC-18, api-contract v1 §5 + v1.1 §B) — the live set of **active** top-up rounds.
 *
 * `EventSource('/backend/topups/stream')` (the BO's streaming proxy, v1.1 §A) →
 *   `event: ready`  → refetch `GET /topups?scope=active` once, mode `live` (no missed-event gap)
 *   `event: topup`  → upsert by `id`; a round whose `active` turned false leaves the map
 *   `onerror`       → close the source, mode `polling`, poll every 10 s, retry the stream every 30 s
 *
 * Everything (source, both timers) is disposed with the owning scope, so no listener can outlive the page
 * or the slide-over that created it.
 */
export function useTopupsLive(options: UseTopupsLiveOptions = {}) {
  const api = useApi()

  const mode = ref<TopupLiveMode>('connecting')
  const byId = ref(new Map<string, TopupView>())
  const pending = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  /** HTTP status of the last failed list read (403 = this admin may not see top-ups at all) */
  const errorStatus = ref<number | null>(null)
  /** bumped after every successful list read (first load, `ready` refetch, poll tick) */
  const syncedAt = ref(0)
  const running = ref(false)

  let source: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setInterval> | null = null
  let session = 0

  const workspaceId = computed(() => toValue(options.workspaceId) || undefined)

  /** newest round first — the same order as `GET /topups?sort=-createdAt` */
  const rows = computed<TopupView[]>(() =>
    [...byId.value.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
  )

  function upsert(topup: TopupView) {
    if (topup.active) byId.value.set(topup.id, topup)
    else byId.value.delete(topup.id)
    options.onTopup?.(topup)
  }

  async function refresh(): Promise<void> {
    const s = ++session
    pending.value = true
    try {
      // retry: 0 — one request per refresh; a failed poll simply waits for the next tick
      const res = await api<TopupsResponse>('/topups', {
        retry: 0,
        query: { scope: 'active', limit: TOPUP_ACTIVE_LIMIT, workspaceId: workspaceId.value }
      })
      if (s !== session) return
      byId.value = new Map((res.topups ?? []).map(t => [t.id, t]))
      loaded.value = true
      error.value = null
      errorStatus.value = null
      syncedAt.value = Date.now()
    } catch (e) {
      if (s !== session) return
      const err = e as FetchError<Partial<ApiErrorBody>>
      error.value = err.data?.error ?? err.message ?? 'โหลดรายการไม่สำเร็จ'
      errorStatus.value = err.response?.status ?? err.statusCode ?? null
    } finally {
      if (s === session) pending.value = false
    }
  }

  function clearTimers() {
    if (pollTimer) clearInterval(pollTimer)
    if (reconnectTimer) clearInterval(reconnectTimer)
    pollTimer = null
    reconnectTimer = null
  }

  function closeSource() {
    if (!source) return
    source.onopen = null
    source.onerror = null
    source.close()
    source = null
  }

  /** the stream is gone: poll the list and keep knocking on the stream (v1.1 §B) */
  function fallBackToPolling() {
    closeSource()
    if (!running.value) return
    mode.value = 'polling'
    if (pollTimer || reconnectTimer) return
    pollTimer = setInterval(() => {
      void refresh()
    }, TOPUP_POLL_MS)
    reconnectTimer = setInterval(() => {
      connect()
    }, TOPUP_RECONNECT_MS)
  }

  function connect() {
    if (!import.meta.client || !running.value || source) return

    const query = workspaceId.value ? `?workspaceId=${encodeURIComponent(workspaceId.value)}` : ''
    let es: EventSource
    try {
      es = new EventSource(`/backend/topups/stream${query}`)
    } catch {
      fallBackToPolling()
      return
    }
    source = es

    es.addEventListener('ready', () => {
      if (source !== es) return
      mode.value = 'live'
      clearTimers()
      void refresh()
    })

    es.addEventListener('topup', (ev) => {
      if (source !== es) return
      try {
        upsert(JSON.parse((ev as MessageEvent<string>).data) as TopupView)
      } catch {
        // a payload we cannot read is not worth killing the stream for; the next poll/refresh repairs the row
      }
    })

    es.onerror = () => {
      if (source !== es) return
      fallBackToPolling()
    }
  }

  /** open the stream (and load the list once) — called on mount / when a slide-over opens */
  function start() {
    if (running.value) return
    running.value = true
    mode.value = 'connecting'
    void refresh()
    connect()
    // no EventSource on the server, and a stream that never opens must not keep the page in `connecting`
    if (!import.meta.client) mode.value = 'polling'
  }

  /** close everything — called on unmount / when a slide-over closes */
  function stop() {
    running.value = false
    session++
    clearTimers()
    closeSource()
    mode.value = 'connecting'
    pending.value = false
  }

  function reset() {
    byId.value = new Map()
    loaded.value = false
    error.value = null
    errorStatus.value = null
  }

  // a workspace filter change restarts both the list and the stream
  watch(workspaceId, () => {
    if (!running.value) return
    closeSource()
    clearTimers()
    reset()
    mode.value = 'connecting'
    void refresh()
    connect()
  })

  if (options.immediate) {
    onMounted(start)
  }
  onScopeDispose(stop)

  return { mode, rows, byId, pending, loaded, error, errorStatus, syncedAt, running, refresh, start, stop }
}
