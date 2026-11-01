import { createSharedComposable } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { AdminPreferences, AdminPreferencesBody, ApiErrorBody } from '#shared/types/auth'
import type {
  NotificationListResponse,
  NotificationReadAllResponse,
  NotificationReadResponse,
  NotificationUnreadCountResponse,
  NotificationView
} from '#shared/types/notifications'

/**
 * FEAT-095 (spec "UI behaviour", api-contract §6) — the one shared source of truth for the admin notifications
 * bell, slideover, corner toasts and the sound. `createSharedComposable`, so the bell in the sidebar, the
 * slideover, the two UserMenu checkboxes and the layout's `nt-root` all read and write the **same** state.
 *
 * Live, exactly like `useTopupsLive`:
 *   `EventSource('/backend/notifications/stream')` (the Nitro proxy) →
 *     `event: ready`        → mode `live`, refresh the unread count + the first page once (no missed-event gap)
 *     `event: notification` → prepend, count+1, run the toast/sound rule
 *     `event: read`         → update `readAt` locally, count−1 when it was unread (multi-tab sync)
 *     `onerror`             → close, poll `unread-count` every 15 s (refresh page 1 when it grows), retry the
 *                             stream every 30 s
 *
 * Toast rule (spec "Toast"): a row toasts only when it arrives **after** the first load (stream `notification`
 * or a poll that reveals a new id), `prefs.notifyToast !== false`, and `route.path !== link.path`. More than
 * `NT_COALESCE_N` arrivals inside `NT_COALESCE_MS` collapse to one summary toast. Rows present at first load
 * never toast (they are seeded into `knownIds` silently).
 *
 * Sound (spec "Sound"): one hidden `<audio>` in the layout (`audioRef`); each toast batch plays it once with
 * 1 s coalescing when `prefs.notifySound` is on; a rejected `play()` is counted, never surfaced as an error.
 */

export const NT_POLL_MS = 15_000
export const NT_STREAM_RETRY_MS = 30_000
export const NT_TOAST_MS = 8_000
export const NT_TOAST_LONG_MS = 15_000
export const NT_COALESCE_N = 3
export const NT_COALESCE_MS = 5_000
export const NT_SOUND_COALESCE_MS = 1_000
export const NT_SOUND_SRC = '/sounds/topup-sound.mp3'
/** page size of the feed (contract §2 default) */
export const NT_PAGE = 30

export type NotificationTab = 'unread' | 'all'
export type NotificationStreamState = 'live' | 'poll' | 'off'

const _useNotifications = () => {
  const api = useApi()
  const toast = useToast()
  const route = useRoute()
  const auth = useAuth()
  /** only GOD sees who triggered an event (spec "Toast" / AC-15); everyone else reads "ระบบ" */
  const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))

  // ── state ──────────────────────────────────────────────────────────────────────────────────────────────────
  const items = ref<NotificationView[]>([])
  const unreadCount = ref(0)
  const nextCursor = ref<string | null>(null)
  const tab = ref<NotificationTab>('unread')
  const streamState = ref<NotificationStreamState>('off')
  const loadingFirst = ref(false)
  const loadingMore = ref(false)
  const loadError = ref<string | null>(null)

  const prefs = reactive({ notifyToast: true, notifySound: true, loaded: false })

  // QA counters (the layout mirrors them onto `nt-root`)
  const events = ref(0)
  const toasts = ref(0)
  const soundPlayed = ref(0)
  const soundBlocked = ref(false)

  /** bound to the layout's hidden `<audio data-testid="nt-audio">` */
  const audioRef = ref<HTMLAudioElement | null>(null)

  const running = ref(false)

  // ── internals ──────────────────────────────────────────────────────────────────────────────────────────────
  let source: EventSource | null = null
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setInterval> | null = null
  let session = 0
  /** ids the UI already knows (seeded on first load → never toast; stream/poll adds toast-eligible ids) */
  const knownIds = new Set<string>()
  let lastPlayAt = 0
  // sliding-window burst tracker for toast coalescing
  let burstStart = 0
  let burstToastIds: Array<string | number> = []
  let burstSummaryId: string | number | null = null
  let burstCount = 0
  let burstFailed = 0

  // ── sound ──────────────────────────────────────────────────────────────────────────────────────────────────
  async function play(): Promise<void> {
    const el = audioRef.value
    if (!el) {
      soundBlocked.value = true
      return
    }
    try {
      el.currentTime = 0
      await el.play()
      soundBlocked.value = false
    } catch {
      soundBlocked.value = true
    }
  }

  function playForBatch(): void {
    if (!prefs.notifySound) return
    const now = Date.now()
    if (now - lastPlayAt < NT_SOUND_COALESCE_MS) return
    lastPlayAt = now
    soundPlayed.value += 1
    void play()
  }

  // ── toast ──────────────────────────────────────────────────────────────────────────────────────────────────
  function toastDuration(level: NotificationView['level']): number {
    return level === 'error' || level === 'warning' ? NT_TOAST_LONG_MS : NT_TOAST_MS
  }

  function openDescription(n: NotificationView): string | undefined {
    const body = n.body ?? undefined
    // only GOD sees who triggered it on the toast (spec "Toast")
    if (isGod.value && n.actor) return `${body ? `${body} · ` : ''}โดย ${n.actor.displayName}`
    return body
  }

  function showSingleToast(n: NotificationView): void {
    const openLabel = n.kind === 'topupOtp' ? 'กรอก OTP' : 'เปิด'
    const id = toast.add({
      title: n.title,
      description: openDescription(n),
      color: n.level,
      icon: levelIcon(n.level),
      duration: toastDuration(n.level),
      actions: [
        {
          label: openLabel,
          color: 'neutral',
          variant: 'outline',
          onClick: () => openLink(n)
        },
        {
          label: 'ไว้ก่อน',
          color: 'neutral',
          variant: 'ghost'
        }
      ]
    }).id
    burstToastIds.push(id)
    toasts.value += 1
  }

  function showSummaryToast(): void {
    const title = `แจ้งเตือนใหม่ ${burstCount} รายการ${burstFailed > 0 ? ` (ล้ม ${burstFailed})` : ''}`
    if (burstSummaryId !== null) {
      toast.remove(burstSummaryId)
    }
    burstSummaryId = toast.add({
      title,
      color: burstFailed > 0 ? 'error' : 'info',
      icon: 'i-lucide-bell-ring',
      duration: NT_TOAST_LONG_MS,
      actions: [
        {
          label: 'เปิดกระดิ่ง',
          color: 'neutral',
          variant: 'outline',
          onClick: () => {
            useDashboard().isNotificationsSlideoverOpen.value = true
          }
        }
      ]
    }).id
    toasts.value += 1
  }

  /** the burst window slides: a new arrival more than NT_COALESCE_MS after the window start opens a new window */
  function enqueueToast(n: NotificationView): void {
    const now = Date.now()
    if (now - burstStart > NT_COALESCE_MS) {
      burstStart = now
      burstToastIds = []
      burstSummaryId = null
      burstCount = 0
      burstFailed = 0
    }
    burstCount += 1
    if (n.level === 'error') burstFailed += 1

    if (burstCount <= NT_COALESCE_N) {
      showSingleToast(n)
    } else {
      // flood: pull the individual toasts of this window and replace them with (or refresh) the summary
      if (burstSummaryId === null) {
        for (const id of burstToastIds) toast.remove(id)
        burstToastIds = []
      }
      showSummaryToast()
    }
    playForBatch()
  }

  /** the one same-page / preference gate every live arrival passes through before it may toast */
  function maybeToast(n: NotificationView): void {
    events.value += 1
    if (prefs.notifyToast === false) return
    if (route.path === n.link.path) return
    enqueueToast(n)
  }

  // ── navigation ─────────────────────────────────────────────────────────────────────────────────────────────
  function openLink(n: NotificationView): void {
    void markRead(n.id)
    useDashboard().isNotificationsSlideoverOpen.value = false
    void navigateTo({ path: n.link.path, query: n.link.query })
  }

  // ── list loading ───────────────────────────────────────────────────────────────────────────────────────────
  function listQuery(cursor?: string | null) {
    const query: Record<string, string | number> = { limit: NT_PAGE }
    if (tab.value === 'unread') query.unread = 1
    if (cursor) query.before = cursor
    return query
  }

  async function loadFirst(): Promise<void> {
    const s = ++session
    loadingFirst.value = true
    loadError.value = null
    try {
      const res = await api<NotificationListResponse>('/notifications', { retry: 0, query: listQuery() })
      if (s !== session) return
      items.value = res.notifications
      nextCursor.value = res.nextCursor
      unreadCount.value = res.unreadCount
      for (const n of res.notifications) knownIds.add(n.id)
    } catch (e) {
      if (s !== session) return
      const err = e as FetchError<Partial<ApiErrorBody>>
      loadError.value = err.data?.error ?? err.message ?? 'โหลดการแจ้งเตือนไม่สำเร็จ'
    } finally {
      if (s === session) loadingFirst.value = false
    }
  }

  async function loadMore(): Promise<void> {
    if (loadingMore.value || !nextCursor.value) return
    loadingMore.value = true
    try {
      const res = await api<NotificationListResponse>('/notifications', { retry: 0, query: listQuery(nextCursor.value) })
      const have = new Set(items.value.map(n => n.id))
      for (const n of res.notifications) {
        if (!have.has(n.id)) items.value.push(n)
        knownIds.add(n.id)
      }
      nextCursor.value = res.nextCursor
      unreadCount.value = res.unreadCount
    } catch {
      // a failed "load more" keeps the cursor so the button can be pressed again
    } finally {
      loadingMore.value = false
    }
  }

  async function setTab(next: NotificationTab): Promise<void> {
    if (tab.value === next) return
    tab.value = next
    await loadFirst()
  }

  async function refreshUnreadCount(): Promise<void> {
    try {
      const res = await api<NotificationUnreadCountResponse>('/notifications/unread-count', { retry: 0 })
      if (res.unreadCount > unreadCount.value) {
        // new rows arrived while the stream was down → refresh page 1 and toast the ones we had not seen
        await refreshFirstPageDiff()
      }
      unreadCount.value = res.unreadCount
    } catch {
      // transient; the next tick retries
    }
  }

  /** poll-mode refresh of page 1: any id we had not seen is a live arrival → toast rule applies */
  async function refreshFirstPageDiff(): Promise<void> {
    try {
      const res = await api<NotificationListResponse>('/notifications', { retry: 0, query: listQuery() })
      const fresh = res.notifications.filter(n => !knownIds.has(n.id))
      items.value = res.notifications
      nextCursor.value = res.nextCursor
      unreadCount.value = res.unreadCount
      for (const n of res.notifications) knownIds.add(n.id)
      for (const n of fresh) maybeToast(n)
    } catch {
      // transient
    }
  }

  // ── read ───────────────────────────────────────────────────────────────────────────────────────────────────
  function applyRead(id: string, readAt: string): void {
    const row = items.value.find(n => n.id === id)
    if (row && row.readAt === null) {
      row.readAt = readAt
      if (unreadCount.value > 0) unreadCount.value -= 1
      // the unread tab drops the row once it is read (next render); keep it until the slideover reloads
    } else if (row) {
      row.readAt = readAt
    }
  }

  async function markRead(id: string): Promise<void> {
    const row = items.value.find(n => n.id === id)
    if (row && row.readAt) return
    // optimistic
    applyRead(id, new Date().toISOString())
    try {
      await api<NotificationReadResponse>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', retry: 0 })
    } catch {
      // the stream / next load reconciles; a lost read mark is not worth a revert flicker
    }
  }

  async function markAllRead(): Promise<void> {
    if (unreadCount.value === 0) return
    const now = new Date().toISOString()
    for (const n of items.value) if (!n.readAt) n.readAt = now
    unreadCount.value = 0
    try {
      await api<NotificationReadAllResponse>('/notifications/read-all', { method: 'POST', retry: 0 })
    } catch {
      // reconciled by the stream / next load
    }
  }

  // ── preferences ────────────────────────────────────────────────────────────────────────────────────────────
  async function loadPrefs(): Promise<void> {
    try {
      const view = await api<AdminPreferences>('/auth/me/preferences', { retry: 0 })
      prefs.notifyToast = view.notifyToast !== false
      prefs.notifySound = view.notifySound !== false
    } catch {
      prefs.notifyToast = true
      prefs.notifySound = true
    } finally {
      prefs.loaded = true
    }
  }

  async function setPref(key: 'notifyToast' | 'notifySound', value: boolean): Promise<void> {
    const previous = prefs[key]
    if (previous === value) return
    prefs[key] = value
    // turning the sound on is the user gesture that unlocks + previews audio (spec "Sound")
    if (key === 'notifySound' && value) void play()
    try {
      const body: AdminPreferencesBody = { [key]: value }
      const view = await api<AdminPreferences>('/auth/me/preferences', { method: 'PATCH', retry: 0, body })
      prefs.notifyToast = view.notifyToast !== false
      prefs.notifySound = view.notifySound !== false
    } catch (e) {
      prefs[key] = previous
      const err = e as FetchError<Partial<ApiErrorBody>>
      toast.add({
        title: 'บันทึกการตั้งค่าไม่สำเร็จ',
        description: err.data?.error ?? err.message ?? 'ลองอีกครั้ง',
        color: 'error'
      })
    }
  }

  // ── live stream + polling fallback ─────────────────────────────────────────────────────────────────────────
  function clearTimers(): void {
    if (pollTimer) clearInterval(pollTimer)
    if (retryTimer) clearInterval(retryTimer)
    pollTimer = null
    retryTimer = null
  }

  function closeSource(): void {
    if (!source) return
    source.onopen = null
    source.onerror = null
    source.close()
    source = null
  }

  function fallBackToPolling(): void {
    closeSource()
    if (!running.value) return
    streamState.value = 'poll'
    if (pollTimer || retryTimer) return
    pollTimer = setInterval(() => {
      void refreshUnreadCount()
    }, NT_POLL_MS)
    retryTimer = setInterval(() => {
      connect()
    }, NT_STREAM_RETRY_MS)
  }

  function connect(): void {
    if (!import.meta.client || !running.value || source) return
    let es: EventSource
    try {
      es = new EventSource('/backend/notifications/stream')
    } catch {
      fallBackToPolling()
      return
    }
    source = es

    es.addEventListener('ready', () => {
      if (source !== es) return
      streamState.value = 'live'
      clearTimers()
      void loadFirst()
    })

    es.addEventListener('notification', (ev) => {
      if (source !== es) return
      let n: NotificationView
      try {
        n = JSON.parse((ev as MessageEvent<string>).data) as NotificationView
      } catch {
        return
      }
      const isNew = !knownIds.has(n.id)
      knownIds.add(n.id)
      // prepend to the feed (both tabs: a fresh row is always unread)
      if (!items.value.some(x => x.id === n.id)) items.value.unshift(n)
      if (isNew) unreadCount.value += 1
      if (isNew) maybeToast(n)
    })

    es.addEventListener('read', (ev) => {
      if (source !== es) return
      try {
        const data = JSON.parse((ev as MessageEvent<string>).data) as NotificationReadResponse
        applyRead(data.id, data.readAt)
      } catch {
        // ignore a payload we cannot read
      }
    })

    es.onerror = () => {
      if (source !== es) return
      fallBackToPolling()
    }
  }

  function start(): void {
    if (running.value) return
    running.value = true
    streamState.value = 'off'
    // the toast rule reads `prefs.notifyToast`, so the stream must not deliver a `notification` before the
    // preferences GET has settled — connect only once it has (loadFirst runs in parallel; it never toasts)
    const prefsReady = loadPrefs()
    void loadFirst()
    if (!import.meta.client) {
      streamState.value = 'poll'
      return
    }
    void prefsReady.finally(() => {
      if (running.value) connect()
    })
  }

  function stop(): void {
    running.value = false
    session++
    clearTimers()
    closeSource()
    streamState.value = 'off'
    items.value = []
    unreadCount.value = 0
    nextCursor.value = null
    knownIds.clear()
    tab.value = 'unread'
    prefs.loaded = false
  }

  return {
    // state
    items,
    unreadCount,
    nextCursor,
    tab,
    streamState,
    loadingFirst,
    loadingMore,
    loadError,
    prefs,
    running,
    audioRef,
    // counters
    events,
    toasts,
    soundPlayed,
    soundBlocked,
    // actions
    start,
    stop,
    loadFirst,
    loadMore,
    setTab,
    markRead,
    markAllRead,
    setPref,
    openLink
  }
}

export const useNotifications = createSharedComposable(_useNotifications)
