/**
 * FEAT-100 (spec "UI behaviour → Polling", AC-30) — the job follow-up of `/mssg-pages`.
 *
 * `GET /mssg-accounts/:id` every 2 s while that account's `job.status` is `pending|waiting|active`, and (contract v2)
 * while its status is `disconnecting`, whose end is the 404 of the deleted account (`onGone`). Same shape as the
 * FEAT-098 unlink loops of `tiktok-accounts.vue`: **one loop per account** (a second `follow()` of the same id is a
 * no-op), never two requests of one loop at a time (`retry: 0` is the caller's), stopped on a terminal job, on a 404
 * (account gone), on `stop()` / `stopAll()` and when the owning scope is disposed (leaving the page). Like
 * `useProfilesPoll`, each loop has a hard deadline (15 min): when it passes the loop stops, the id is kept in
 * `timedOut` and `onTimeout` fires once; a timed-out id is not restarted by `track()` until `resetTimeouts()`.
 *
 * FEAT-101: generic over the followed view. The editor follows `GET /mssg-sites/:id` with `needsPoll` = "the site's
 * job is open"; without `needsPoll` the FEAT-100 account rule (`mssgNeedsPoll`) applies, so `/mssg-pages` is unchanged.
 */
import type { MssgAccountView } from '#shared/types/mssg-accounts'

interface Loop {
  timer: ReturnType<typeof setInterval>
  inFlight: boolean
  deadline: number
}

export interface MssgPollHandlers<T = MssgAccountView> {
  /** one read of the account (the page passes `api('/mssg-accounts/:id', { retry: 0 })`) */
  read: (id: string) => Promise<T>
  /** every answer, open or terminal */
  onUpdate: (view: T) => void
  /** the answer that ended the loop (terminal job and not `disconnecting`, or no job at all) */
  onEnd?: (view: T) => void
  /** 404: the account no longer exists — v2: the normal end of an unlink (`disconnecting`), else unlinked elsewhere */
  onGone?: (id: string) => void
  /** the 15 min deadline passed */
  onTimeout?: (id: string) => void
  /** FEAT-101 — keep following after this answer? Default: the account rule `mssgNeedsPoll` */
  needsPoll?: (view: T) => boolean
}

export function useMssgPoll<T = MssgAccountView>(handlers: MssgPollHandlers<T>) {
  const needsPoll = handlers.needsPoll ?? ((view: T) => mssgNeedsPoll(view as unknown as MssgAccountView))
  const loops = new Map<string, Loop>()
  /** ids with a running loop (reactive copy of `loops`' keys, for data attributes and the UI) */
  const polling = ref<string[]>([])
  /** ids whose loop hit the deadline */
  const timedOut = ref<string[]>([])

  function syncPolling() {
    polling.value = [...loops.keys()]
  }

  function stop(id: string) {
    const loop = loops.get(id)
    if (loop) clearInterval(loop.timer)
    loops.delete(id)
    syncPolling()
  }

  function stopAll() {
    for (const id of [...loops.keys()]) stop(id)
  }

  async function tick(id: string) {
    const loop = loops.get(id)
    if (!loop) return
    if (Date.now() >= loop.deadline) {
      stop(id)
      if (!timedOut.value.includes(id)) timedOut.value = [...timedOut.value, id]
      handlers.onTimeout?.(id)
      return
    }
    if (loop.inFlight) return
    loop.inFlight = true
    try {
      const view = await handlers.read(id)
      if (loops.get(id) !== loop) return // stopped meanwhile (page left, area switched, unlinked)
      handlers.onUpdate(view)
      if (!needsPoll(view)) {
        stop(id)
        handlers.onEnd?.(view)
      }
    } catch (e) {
      const status = (e as { statusCode?: number, response?: { status?: number } }).response?.status
        ?? (e as { statusCode?: number }).statusCode
      if (status === 404 && loops.get(id) === loop) {
        stop(id)
        handlers.onGone?.(id)
      }
      // anything else is transient: the next tick reads again, the deadline ends the loop
    } finally {
      loop.inFlight = false
    }
  }

  /** start following one account (no-op when a loop already runs for it); clears an earlier time-out of that id */
  function follow(id: string) {
    if (timedOut.value.includes(id)) timedOut.value = timedOut.value.filter(x => x !== id)
    if (loops.has(id)) return
    loops.set(id, {
      timer: setInterval(() => {
        void tick(id)
      }, MSSG_POLL_MS),
      inFlight: false,
      deadline: Date.now() + MSSG_POLL_MAX_MS
    })
    syncPolling()
  }

  /**
   * Declare which accounts currently have an open job (call it from a watcher on the list). New ids start a loop,
   * ids that are no longer listed stop theirs. Timed-out ids are left alone until `resetTimeouts()`.
   */
  function track(openIds: string[]) {
    const wanted = new Set(openIds)
    for (const id of [...loops.keys()]) {
      if (!wanted.has(id)) stop(id)
    }
    for (const id of wanted) {
      if (!timedOut.value.includes(id)) follow(id)
    }
  }

  /** forget every time-out (the user reloaded the list on purpose) */
  function resetTimeouts() {
    timedOut.value = []
  }

  onScopeDispose(stopAll)

  return {
    polling,
    timedOut,
    isPolling: (id: string) => polling.value.includes(id),
    hasTimedOut: (id: string) => timedOut.value.includes(id),
    follow,
    track,
    stop,
    stopAll,
    resetTimeouts
  }
}
