import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { FetchNowConflictBody, FetchNowResponse } from '#shared/types/reports'

/** while an advertiser is `fetching` the surface re-reads itself every 5 s, for at most 3 minutes */
export const FETCH_NOW_POLL_MS = 5000
export const FETCH_NOW_MAX_MS = 180_000

/**
 * FEAT-020 — the "ดึงตอนนี้" button of the ad slideover (`rp-ad-fetch`) and of an order build card
 * (`or-build-fetch`) behave identically (api-contract §6.3 / §6.4): one `POST
 * /advertisers/:id/report/fetch-now`, a 409 shown as a toast with the API's own text, and while the
 * advertiser reports `fetching` the surface re-reads itself every 5 s until it stops or 3 minutes pass.
 *
 * The timer is owned here: it is cleared on unmount, on `stop()` (the caller does that when its slideover
 * closes) and as soon as a re-read says `fetching` is false, so no timer can survive the surface.
 */
export function useFetchNow() {
  const api = useApi()
  const toast = useToast()

  /** a POST is in flight */
  const requesting = ref(false)
  /** the 5 s re-read loop runs */
  const watching = ref(false)

  let timer: ReturnType<typeof setInterval> | null = null
  let deadline = 0

  function stop() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    watching.value = false
  }

  /**
   * Re-read `reread()` every 5 s until it answers `false` (= no longer fetching) or 3 minutes are over.
   * Calling it again restarts the window.
   */
  function watchUntilDone(reread: () => Promise<boolean>) {
    stop()
    watching.value = true
    deadline = Date.now() + FETCH_NOW_MAX_MS
    timer = setInterval(() => {
      if (Date.now() >= deadline) {
        stop()
        return
      }
      void reread().then((stillFetching) => {
        if (!stillFetching) stop()
      }).catch(() => {
        // a failed re-read is not fatal: the next tick tries again, the deadline ends the loop
      })
    }, FETCH_NOW_POLL_MS)
  }

  /**
   * `POST /advertisers/:id/report/fetch-now`. Returns the 202 body, or `null` when the API refused
   * (409 and every other failure are shown as a toast with the API text — never a silent no-op).
   */
  async function request(advertiserId: string): Promise<FetchNowResponse | null> {
    if (!advertiserId || requesting.value) return null
    requesting.value = true
    try {
      // retry: 0 — exactly one POST per click
      const res = await api<FetchNowResponse>(
        `/advertisers/${encodeURIComponent(advertiserId)}/report/fetch-now`,
        { method: 'POST', retry: 0 }
      )
      toast.add({ title: 'สั่งดึงข้อมูลแล้ว', description: 'ระบบกำลังดึงยอดของวันนี้', color: 'success' })
      return res
    } catch (e) {
      const err = e as FetchError<Partial<ApiErrorBody & FetchNowConflictBody>>
      const status = err.response?.status ?? err.statusCode
      const message = err.data?.error ?? err.message ?? 'ดึงข้อมูลไม่สำเร็จ'
      toast.add({
        title: 'ดึงตอนนี้ไม่สำเร็จ',
        description: message,
        color: status === 409 ? 'warning' : 'error'
      })
      return null
    } finally {
      requesting.value = false
    }
  }

  onScopeDispose(stop)

  return { requesting, watching, request, watchUntilDone, stop }
}
