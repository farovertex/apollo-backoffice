import type { TopupOptionsResponse } from '#shared/types/topups'

/**
 * FEAT-053 (api-contract §1, AC-22) — `GET /topups/options?tiktokAccountId=…`: the server's own QR minimum,
 * per-currency card limits and how much of the per-day cap this account has left today.
 *
 * Why a composable and not `useLazyAsyncData`: the two surfaces that need it are a popover and a modal that open
 * and close many times per page, always for **one** account, and the contract asks for exactly **one** request
 * per open (same rule as `GET payment-cards` in `CardPayModal`). So:
 *   - `load(accountId)` fires one request (`retry: 0`) and caches it for as long as that surface stays open;
 *     calling it again with the same id while a request is in flight (or already answered) does nothing.
 *   - `reset()` on close drops the cache, so the next open reads fresh numbers.
 *   - **a failure is not an error state**: `options` stays `null`, nothing is shown to the admin, and every
 *     caller falls back to `TOPUP_CARD_LIMITS` / `TOPUP_MIN_AMOUNT` (spec assumption 9 — the new endpoint must
 *     never block a payment or invent a number).
 *
 * FEAT-077 (api-contract §6.5) — the same answer now carries `telegram { available, chatTitle, reason }`; it is passed
 * through untouched (the pay popover shows its "ส่ง Telegram" switch only for `available === true`). No new request.
 */
export function useTopupOptions() {
  const api = useApi()

  const options = ref<TopupOptionsResponse | null>(null)
  const pending = ref(false)
  /** the account the cached answer belongs to (`''` = nothing cached) */
  const loadedFor = ref('')
  let session = 0

  async function load(tiktokAccountId: string) {
    if (!tiktokAccountId) return
    if (loadedFor.value === tiktokAccountId && (options.value || pending.value)) return
    const current = ++session
    loadedFor.value = tiktokAccountId
    pending.value = true
    try {
      // retry: 0 — one read per open, whatever happens
      const res = await api<TopupOptionsResponse>('/topups/options', {
        retry: 0,
        query: { tiktokAccountId }
      })
      if (current !== session) return
      options.value = res
    } catch {
      // silent fallback: the hint table in `app/utils/topup.ts` takes over (AC-22)
      if (current !== session) return
      options.value = null
    } finally {
      if (current === session) pending.value = false
    }
  }

  function reset() {
    session++
    options.value = null
    pending.value = false
    loadedFor.value = ''
  }

  return { options, pending, load, reset }
}
