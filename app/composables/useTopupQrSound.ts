import type { FetchError } from 'ofetch'
import type { AdminPreferences, AdminPreferencesBody, ApiErrorBody } from '#shared/types/auth'
import type { TopupStatus, TopupView } from '#shared/types/topups'

/**
 * FEAT-033 (spec "UI behaviour (BO)", api-contract v1 §5/§7) — the QR-ready sound alert of `/topups`.
 *
 * One composable owns everything the feature needs, because all four parts share the same lifetime:
 *  - **the preference** (`GET`/`PATCH /auth/me/preferences`, per admin and server-side, default off — G-2/G-3),
 *  - **the audio handle** (`audioRef` = the page's single `<audio>`; no `new Audio()`, so the element dies with
 *    the page and nothing can keep sounding after a route change — G-6),
 *  - **the detector** over the live rows of `useTopupsLive` (`observe()`), and
 *  - **the counters** QA observes instead of listening (`events` / `played` / `blocked`, AS-10).
 *
 * **Page-scoped on purpose (AS-8).** `topups.vue` instantiates it; it is not a plugin, not a global store and not
 * used by the advertisers slide-over, so the sound exists on `/topups` and nowhere else (G-6). Everything it
 * registers (`onMounted`, the `watch` of `observe()`) belongs to the calling scope and is disposed with it.
 *
 * **Why counters exist.** Playwright cannot hear a sound, and `play()` is routinely rejected by the autoplay
 * policy in a headless run (F5). So the page publishes what happened: `events` = QR-ready transitions detected
 * (counted **even while the switch is off** — AS-6, that is how QA proves "detected but silent", and it is also
 * why turning the switch on later replays nothing: the counters are not a queue), `played` = `play()` calls caused
 * by a detection (never the test button, never the enable preview), `blocked` = the last `play()` was rejected.
 *
 * **The rule** is purely "became `readyToPay` since the detector last saw it" (api-contract §5):
 *  - the first list load after mount (and after a workspace-filter change) seeds silently → the rows that already
 *    had a QR never chime (G-9, AC-11);
 *  - an id the detector does not know counts as "not seen", so a round that appears straight as `readyToPay` chimes;
 *  - a round that reached `paying` before the next read is only ever seen as `paying` → no chime (AS-4);
 *  - a `paying → readyToPay` release chimes again — it is a QR waiting for a payer once more (AS-5);
 *  - several rounds in the same list change count as several events but make **one** sound, and so does any event
 *    inside `TOPUP_SOUND_COALESCE_MS` after a sound (G-8/G-11, no queue, no repeat).
 */

/** the file already tracked in `public/sounds/` (G-1) — nobody adds another one */
export const TOPUP_SOUND_SRC = '/sounds/topup-sound.mp3'
/** "several rounds within 1 s → one sound" (G-8) */
export const TOPUP_SOUND_COALESCE_MS = 1000

/** `loading` until the preference GET settled, then the saved value (`tp-page[data-sound]`) */
export type TopupSoundState = 'loading' | 'on' | 'off'

export function useTopupQrSound() {
  const api = useApi()
  const toast = useToast()

  /** bound to the page's `<audio data-testid="tp-sound-audio">` */
  const audioRef = ref<HTMLAudioElement | null>(null)

  const enabled = ref(false)
  /** the GET answered (or failed) — until then the controls are disabled and `data-sound` is `loading` */
  const settled = ref(false)
  /** a PATCH is in flight: the toggle is disabled, so one click = at most one request */
  const busy = ref(false)

  const events = ref(0)
  const played = ref(0)
  const blocked = ref(false)

  const state = computed<TopupSoundState>(() =>
    !settled.value ? 'loading' : enabled.value ? 'on' : 'off'
  )

  /** `null` = disarmed (no successful list load yet, or the filter just changed); otherwise id → last seen status */
  let seen: Map<string, TopupStatus> | null = null
  let lastPlayAt = 0

  /**
   * One sound from the start. The rejection is swallowed on purpose: before the first user gesture the autoplay
   * policy rejects with `NotAllowedError` (F5, accepted in G-12) and that must never become a console error or a
   * toast — `blocked` carries it to QA instead.
   */
  async function play(): Promise<void> {
    const el = audioRef.value
    if (!el) {
      blocked.value = true
      return
    }
    try {
      el.currentTime = 0
      await el.play()
      blocked.value = false
    } catch {
      blocked.value = true
    }
  }

  /**
   * Exactly one `GET /backend/auth/me/preferences` on mount (`retry: 0`). Any failure → `off` with **no** alert and
   * **no** toast: the admin did not ask for anything, the failed request itself is the evidence (api-contract §5),
   * the controls stay usable and a later PATCH may still succeed. A 401 is `useApi`'s business (it redirects).
   */
  async function load(): Promise<void> {
    try {
      const view = await api<AdminPreferences>('/auth/me/preferences', { retry: 0 })
      enabled.value = view.topupQrSound === true
    } catch {
      enabled.value = false
    } finally {
      settled.value = true
    }
  }

  /**
   * Optimistic flip + exactly one `PATCH { topupQrSound }`; the 200 body wins, a failure reverts and toasts.
   * Turning it **on** also plays once (AS-3): the click is the gesture that unlocks audio for the whole document
   * and a preview at the same time — `play()` is called inside the handler, before any `await`, or the gesture
   * would already be spent. These plays are not detections, so `played` does not move.
   */
  async function toggle(): Promise<void> {
    if (!settled.value || busy.value) return

    const previous = enabled.value
    const next = !previous
    enabled.value = next
    busy.value = true
    if (next) void play()

    try {
      const body: AdminPreferencesBody = { topupQrSound: next }
      const view = await api<AdminPreferences>('/auth/me/preferences', { method: 'PATCH', retry: 0, body })
      enabled.value = view.topupQrSound === true
    } catch (e) {
      enabled.value = previous
      const err = e as FetchError<Partial<ApiErrorBody>>
      toast.add({
        title: 'บันทึกการตั้งค่าเสียงไม่สำเร็จ',
        description: err.data?.error ?? err.message ?? 'ลองอีกครั้ง',
        color: 'error'
      })
    } finally {
      busy.value = false
    }
  }

  /** `tp-sound-test`: one play, whatever the switch says; no request, no state change, not counted (AC-8) */
  function test(): void {
    void play()
  }

  /**
   * Wire the detector to `useTopupsLive`. Watching `rows` (a computed over `byId`) covers every path at once —
   * an SSE `topup` upsert, the `ready` refetch, a 10 s poll tick and the `tp-refresh` button (F2) — so there is
   * no API change and no second source of truth. `loaded` is the arming signal: `reset()` on a workspace-filter
   * change drops it to `false`, which disarms the detector so the next (filtered) list seeds silently (AC-11).
   */
  function observe(rows: MaybeRefOrGetter<TopupView[]>, loaded: MaybeRefOrGetter<boolean>): void {
    watch(
      [() => toValue(rows), () => toValue(loaded)],
      ([list, isLoaded]) => {
        if (!isLoaded) {
          seen = null
          return
        }

        const next = new Map(list.map(row => [row.id, row.status]))
        if (!seen) {
          // first armed evaluation: whatever is on screen is "already known", nothing chimes (G-9)
          seen = next
          return
        }

        let detected = 0
        for (const row of list) {
          if (row.status === 'readyToPay' && seen.get(row.id) !== 'readyToPay') detected += 1
        }
        // ids that left the active list are dropped with the replacement, so a round that comes back chimes again
        seen = next
        if (detected === 0) return

        events.value += detected
        if (!enabled.value) return

        const now = Date.now()
        if (now - lastPlayAt < TOPUP_SOUND_COALESCE_MS) return
        lastPlayAt = now
        played.value += 1
        void play()
      },
      { immediate: true }
    )
  }

  onMounted(load)

  return { audioRef, enabled, state, busy, events, played, blocked, load, toggle, test, observe }
}
