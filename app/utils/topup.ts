import type { AdvertiserTopup, AdvertiserTopupPhase } from '#shared/types/advertisers'

/** นาฬิกา 30 นาทีเริ่มตอนเซฟรูป — ตรงกับ apollo-api `TOPUP_CLOCK_MS` */
export const TOPUP_CLOCK_MS = 30 * 60 * 1000

export function clockRemainingMs(qrSavedAt: string | null, now = Date.now()): number {
  if (!qrSavedAt) return 0
  return Math.max(0, new Date(qrSavedAt).getTime() + TOPUP_CLOCK_MS - now)
}

export function formatRemain(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** บัญชีนี้จ่ายต่อไม่ได้จนกว่า processing จะจบ หรือนาฬิกาของ ready/pending จะหมด */
export function topupBlocksAccount(t: AdvertiserTopup | null | undefined, now = Date.now()): boolean {
  if (!t?.phase) return false
  if (t.phase === 'processing') return true
  if (t.phase === 'ready' || t.phase === 'pending') return clockRemainingMs(t.qrSavedAt, now) > 0
  return false
}

export function showTopupRefresh(t: AdvertiserTopup | null | undefined, now = Date.now()): boolean {
  if (!t?.phase || t.phase === 'processing' || t.phase === 'paid') return false
  if (t.phase === 'pending' || t.phase === 'expired') return true
  return t.phase === 'ready' && clockRemainingMs(t.qrSavedAt, now) === 0
}

/** ปุ่มจ่ายของแถวนี้ — ทั้งบัญชีถูกปิดเมื่อมีแถวที่บล็อก หรือมี job กำลังรัน */
export function showPayButton(t: AdvertiserTopup | null | undefined, accountBusy: boolean, now = Date.now()): boolean {
  if (accountBusy || !t) return false
  if (t.phase === null || t.phase === 'expired') return true
  if (t.phase === 'paid' || t.phase === 'processing') return false
  return clockRemainingMs(t.qrSavedAt, now) === 0
}

export const TOPUP_BADGE: Record<AdvertiserTopupPhase, { label: string, color: 'neutral' | 'primary' | 'warning' | 'success' | 'error' }> = {
  processing: { label: 'Processing', color: 'neutral' },
  ready: { label: 'Ready', color: 'primary' },
  pending: { label: 'Pending', color: 'warning' },
  paid: { label: 'Paid', color: 'success' },
  expired: { label: 'Expired', color: 'error' }
}
