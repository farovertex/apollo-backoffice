import type { FetchError } from 'ofetch'
import type { TopupClaimConflictBody, TopupClaimResponse, TopupMutationResponse, TopupView } from '#shared/types/topups'

/**
 * FEAT-021 — every top-up mutation of the BO in one place (api-contract v1 §4), so the advertisers
 * slide-over and the `/topups` page behave identically:
 *
 *   `open()`    `POST /topups/:id/claim`      → 200 opens the pay modal with the `qrImage` of that answer
 *   `cancel()`  `POST /topups/:id/cancel`     → back to `readyToPay`
 *   `confirm()` `POST /topups/:id/confirm`    → `verifying`
 *   `recheck()` `POST /topups/:id/recheck`    → 202, one more check job (D15)
 *   `release()` `POST /topups/:id/release`    → GOD breaks someone else's lease (AC-19)
 *
 * Every failure becomes a toast carrying the API's own `error` text **as-is** (the API speaks Thai, the BO
 * never rewrites it). The modal is owned here too: it opens **only** after a `claim` 200, never optimistically.
 * `POST /topups` itself lives in `TopupsPayPopover`, which needs the 400 body inside the popover, not a toast.
 */
export function useTopupPay(onChange?: (topup: TopupView) => void) {
  const api = useApi()
  const toast = useToast()

  /** the round shown in the pay modal */
  const current = ref<TopupView | null>(null)
  /** the QR of the current claim — never stored anywhere else, dropped when the modal closes */
  const qrImage = ref<string | null>(null)
  const modalOpen = ref(false)
  /** id of the round with a request in flight (one spinner per row) */
  const busyId = ref<string | null>(null)
  /** set to the id of a round whose 409 proved the row is stale — the caller re-reads and clears it */
  const staleId = ref<string | null>(null)

  function notifyError(title: string, e: unknown, fallback: string) {
    const err = e as FetchError<Partial<TopupClaimConflictBody>>
    const status = err.response?.status ?? err.statusCode
    toast.add({
      title,
      'description': err.data?.error ?? err.message ?? fallback,
      'color': status === 409 || status === 403 ? 'warning' : 'error',
      'data-testid': 'ta-toast'
    } as Parameters<typeof toast.add>[0])
    return err
  }

  function changed(topup: TopupView) {
    if (current.value?.id === topup.id) current.value = topup
    onChange?.(topup)
    return topup
  }

  /**
   * AC-17 — claim the round and open the modal with the QR of that very answer. A 409 is a toast and
   * nothing else; a 409 that says the QR expired also asks the caller to re-read the row.
   */
  async function open(topup: TopupView): Promise<TopupView | null> {
    if (busyId.value) return null
    busyId.value = topup.id
    try {
      const res = await api<TopupClaimResponse>(`/topups/${encodeURIComponent(topup.id)}/claim`, { method: 'POST', retry: 0 })
      current.value = res.topup
      qrImage.value = res.qrImage
      modalOpen.value = true
      onChange?.(res.topup)
      return res.topup
    } catch (e) {
      const err = notifyError('จองไม่สำเร็จ', e, 'จองไม่สำเร็จ')
      // "QR หมดอายุแล้ว" / "รอบนี้ไม่ได้อยู่ในสถานะพร้อมจ่าย" — the row the user sees is stale
      if ((err.response?.status ?? err.statusCode) === 409) staleId.value = topup.id
      return null
    } finally {
      busyId.value = null
    }
  }

  async function mutate(
    topup: TopupView,
    action: 'cancel' | 'confirm' | 'recheck' | 'release',
    failureTitle: string
  ): Promise<TopupView | null> {
    if (busyId.value) return null
    busyId.value = topup.id
    try {
      const res = await api<TopupMutationResponse>(
        `/topups/${encodeURIComponent(topup.id)}/${action}`,
        { method: 'POST', retry: 0 }
      )
      return changed(res.topup)
    } catch (e) {
      notifyError(failureTitle, e, 'ทำรายการไม่สำเร็จ')
      return null
    } finally {
      busyId.value = null
    }
  }

  async function cancel(topup: TopupView) {
    return mutate(topup, 'cancel', 'ยกเลิกไม่สำเร็จ')
  }

  async function confirm(topup: TopupView) {
    return mutate(topup, 'confirm', 'ยืนยันไม่สำเร็จ')
  }

  async function recheck(topup: TopupView) {
    return mutate(topup, 'recheck', 'สั่งตรวจไม่สำเร็จ')
  }

  async function release(topup: TopupView) {
    return mutate(topup, 'release', 'ปลดการจองไม่สำเร็จ')
  }

  /** the modal is done with the round (closed, cancelled, confirmed or the lease ran out) */
  function closeModal() {
    modalOpen.value = false
    current.value = null
    qrImage.value = null
  }

  /** a plain `{ error }` toast for anything the surfaces need to say (lease timeout, …) */
  function notify(title: string, description: string, color: 'success' | 'warning' | 'error' = 'warning') {
    toast.add({ title, description, color, 'data-testid': 'ta-toast' } as Parameters<typeof toast.add>[0])
  }

  return {
    current,
    qrImage,
    modalOpen,
    busyId,
    staleId,
    open,
    cancel,
    confirm,
    recheck,
    release,
    closeModal,
    notify
  }
}
