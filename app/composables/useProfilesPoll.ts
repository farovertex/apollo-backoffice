/**
 * FEAT-024 (spec A12) — the one re-read timer of `/browser-profiles`.
 *
 * Two things on that page are asynchronous now: the profile list **sync** (`provider{syncList}` job) and a **reserved**
 * row waiting for its `provider{create}` job. Both are observed the same way: re-read `GET …/available` every 2 s until
 * the reason is gone, for at most 90 s.
 *
 * Design (same shape as `useFetchNow`): **one** interval for the whole page, owned here, cleared on unmount, on
 * `stop()` and as soon as no reason is left — so no timer can survive the page and two reasons never create two
 * timers. Each reason gets its own 90 s deadline (a sync that starts while a row is provisioning is not cut short by
 * the older deadline); when a deadline passes, the reason is dropped, `onTimeout` fires once and the reason is
 * **given up** until it disappears from the data (so the page can enable its button again and does not immediately
 * restart the loop against the same stuck job).
 */

/** re-read interval while something is in flight */
export const PROFILES_POLL_MS = 2000
/** hard cap per reason */
export const PROFILES_POLL_MAX_MS = 90_000

/** why the page is re-reading: the sync job, or at least one visible `provisioning` row */
export type ProfilesPollReason = 'sync' | 'provisioning'

export function useProfilesPoll(reread: () => Promise<unknown>) {
  /** reasons currently being waited on (a timer runs iff this is not empty) */
  const waiting = ref<ProfilesPollReason[]>([])
  /** reasons that hit the 90 s cap; cleared again when the reason disappears from the data */
  const gaveUp = ref<ProfilesPollReason[]>([])

  let timer: ReturnType<typeof setInterval> | null = null
  /** reason → absolute deadline (ms epoch) */
  const deadlines = new Map<ProfilesPollReason, number>()
  /** a re-read is in flight — never two overlapping GETs */
  let inFlight = false
  const timeoutHandlers = new Map<ProfilesPollReason, () => void>()

  function syncWaiting() {
    waiting.value = [...deadlines.keys()]
  }

  function clearTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }

  function stop() {
    clearTimer()
    deadlines.clear()
    syncWaiting()
  }

  /** called by the page when a reason timed out, e.g. to show the "taking longer than expected" toast */
  function onTimeout(reason: ProfilesPollReason, handler: () => void) {
    timeoutHandlers.set(reason, handler)
  }

  function tick() {
    const now = Date.now()
    for (const [reason, deadline] of [...deadlines]) {
      if (now >= deadline) {
        deadlines.delete(reason)
        if (!gaveUp.value.includes(reason)) gaveUp.value = [...gaveUp.value, reason]
        timeoutHandlers.get(reason)?.()
      }
    }
    if (!deadlines.size) {
      clearTimer()
      syncWaiting()
      return
    }
    syncWaiting()
    if (inFlight) return
    inFlight = true
    void Promise.resolve(reread())
      .catch(() => {
        // a failed re-read is not fatal: the next tick tries again, the deadline ends the loop
      })
      .finally(() => {
        inFlight = false
      })
  }

  /**
   * Declare the reasons the **current data** still waits for (call it from a watcher, `immediate: true`).
   * New reason → its 90 s window starts · reason gone → its deadline and its "given up" flag are dropped ·
   * nothing left → the timer is cleared.
   */
  function track(reasons: ProfilesPollReason[]) {
    const active = new Set(reasons)
    for (const reason of [...deadlines.keys()]) {
      if (!active.has(reason)) deadlines.delete(reason)
    }
    if (gaveUp.value.some(reason => !active.has(reason))) {
      gaveUp.value = gaveUp.value.filter(reason => active.has(reason))
    }
    for (const reason of active) {
      // a reason we already gave up on does not restart until the data says it is over
      if (gaveUp.value.includes(reason)) continue
      if (!deadlines.has(reason)) deadlines.set(reason, Date.now() + PROFILES_POLL_MAX_MS)
    }
    syncWaiting()
    if (!deadlines.size) {
      clearTimer()
      return
    }
    if (!timer) timer = setInterval(tick, PROFILES_POLL_MS)
  }

  /**
   * Explicitly re-open a reason's 90 s window (the admin pressed the button again after a give-up).
   * Still the same single interval.
   */
  function retry(reason: ProfilesPollReason) {
    gaveUp.value = gaveUp.value.filter(r => r !== reason)
    deadlines.set(reason, Date.now() + PROFILES_POLL_MAX_MS)
    syncWaiting()
    if (!timer) timer = setInterval(tick, PROFILES_POLL_MS)
  }

  onScopeDispose(stop)

  return {
    /** reasons a re-read loop is running for (`[]` = no timer) */
    waiting,
    /** reasons that hit the 90 s cap and are not polled again until they clear */
    gaveUp,
    /** true while the page is re-reading at all — handy for a data-attribute QA can watch */
    polling: computed(() => waiting.value.length > 0),
    isWaiting: (reason: ProfilesPollReason) => waiting.value.includes(reason),
    hasGivenUp: (reason: ProfilesPollReason) => gaveUp.value.includes(reason),
    track,
    retry,
    onTimeout,
    stop
  }
}
