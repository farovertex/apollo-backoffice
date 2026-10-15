import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { TopupMutationResponse, TopupView } from '#shared/types/topups'

/**
 * FEAT-051 (api-contract §4/§5) — the two mutations of a card round that is waiting for a human:
 *
 *   `approve()` `POST /topups/:id/approve` → `paying` + one `cardPay` job (the confirm dialog is the approval)
 *   `cancel()`  `POST /topups/:id/cancel`  → `cardFailed` reason `cancelled`, the account is free again
 *
 * It is deliberately separate from `useTopupPay` (claim / confirm / recheck / release of the QR flow): those are
 * owned by the page, these are owned by the row, so a card round behaves the same in the `/topups` table, on the
 * accounts table and in the advertisers slide-over without three wirings.
 *
 * Every failure becomes a toast carrying the API's own `error` text as-is (409 "รอบนี้กำลังจ่ายอยู่ ยกเลิกไม่ได้",
 * 409 "รอบนี้หมดอายุไปแล้ว", 503 of a server without the card key …). `retry: 0` + one `busy` flag make a double
 * click impossible — this is money.
 */
export function useTopupCard() {
  const api = useApi()
  const toast = useToast()

  const busy = ref(false)

  function fail(title: string, e: unknown) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    toast.add({
      title,
      'description': err.data?.error ?? err.message ?? 'ทำรายการไม่สำเร็จ',
      'color': status === 409 || status === 403 ? 'warning' : 'error',
      'data-testid': 'ta-toast'
    } as Parameters<typeof toast.add>[0])
  }

  async function mutate(topup: TopupView, action: 'approve' | 'cancel', title: string): Promise<TopupView | null> {
    if (busy.value) return null
    busy.value = true
    try {
      const res = await api<TopupMutationResponse>(
        `/topups/${encodeURIComponent(topup.id)}/${action}`,
        { method: 'POST', retry: 0 }
      )
      return res.topup
    } catch (e) {
      fail(title, e)
      return null
    } finally {
      busy.value = false
    }
  }

  /** the human gate of the money: this call only ever happens from the confirm dialog (AC-33) */
  async function approve(topup: TopupView) {
    return mutate(topup, 'approve', 'จ่ายเงินไม่สำเร็จ')
  }

  async function cancel(topup: TopupView) {
    return mutate(topup, 'cancel', 'ยกเลิกไม่สำเร็จ')
  }

  return { busy, approve, cancel }
}
