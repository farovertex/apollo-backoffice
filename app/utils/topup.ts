/**
 * FEAT-021 — presentation rules of one top-up round, shared by the advertisers slide-over (`ta-adv-topup-*`)
 * and the `/topups` page (`tp-row-*`). api-contract.md v1 §3/§4 and the **v1.1 addendum §C** decide which
 * element a row renders; this file is the single implementation of that table so the two surfaces can never
 * drift apart.
 *
 * Nothing here talks to the API and nothing invents a state: the API owns the status, the BO owns the words.
 */
import type { AdminRole } from '#shared/types/auth'
import type { TopupStatus, TopupView } from '#shared/types/topups'

/** `TOPUP_MIN_AMOUNT` of the API (api-contract §1). The API's 400 body stays the authority — this is the hint. */
export const TOPUP_MIN_AMOUNT = 400

export type TopupBadgeColor = 'neutral' | 'primary' | 'info' | 'warning' | 'success' | 'error'

/** spec "สถานะของหนึ่งรอบ" — one label and one colour per status */
export const TOPUP_BADGE: Record<TopupStatus, { label: string, color: TopupBadgeColor }> = {
  waitingQr: { label: 'กำลังรอ QR code', color: 'neutral' },
  qrFailed: { label: 'ขอ QR ไม่สำเร็จ', color: 'error' },
  readyToPay: { label: 'Ready to pay', color: 'primary' },
  paying: { label: 'กำลังจ่ายเงิน', color: 'warning' },
  verifying: { label: 'กำลังตรวจสอบเงิน', color: 'info' },
  paid: { label: 'สำเร็จ', color: 'success' },
  notFound: { label: 'ไม่พบยอด', color: 'error' },
  expired: { label: 'QR หมดอายุ', color: 'neutral' }
}

/** every status, in the order of the state machine — the `status` filter of the history tab */
export const TOPUP_STATUSES = Object.keys(TOPUP_BADGE) as TopupStatus[]

/** badge text of a row: `paying` carries the name of the admin holding the lease (v1.1 §C) */
export function topupBadgeLabel(topup: TopupView | null | undefined): string {
  if (!topup) return ''
  const base = TOPUP_BADGE[topup.status]?.label ?? topup.status
  if (topup.status === 'paying' && topup.payingBy?.displayName) {
    return `${base} · ${topup.payingBy.displayName}`
  }
  return base
}

export function topupBadgeColor(topup: TopupView | null | undefined): TopupBadgeColor {
  return topup ? (TOPUP_BADGE[topup.status]?.color ?? 'neutral') : 'neutral'
}

function remainingMs(iso: string | null | undefined, now: number): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, t - now)
}

/** milliseconds left on the 24 h QR clock (`qrExpiresAt`); 0 when there is no QR or it is over */
export function qrRemainingMs(topup: TopupView | null | undefined, now = Date.now()): number {
  return remainingMs(topup?.qrExpiresAt, now)
}

/** milliseconds left on the 5 min claim lease (`payingExpiresAt`); 0 when nobody holds it */
export function leaseRemainingMs(topup: TopupView | null | undefined, now = Date.now()): number {
  if (!topup || topup.status !== 'paying') return 0
  return remainingMs(topup.payingExpiresAt, now)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** `4:59` — mm:ss, used for the claim lease (v1.1 §C `ta-adv-topup-lease-remain`) */
export function formatRemain(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(total / 60)}:${pad(total % 60)}`
}

/** `23:59:01` — hh:mm:ss, used for the QR clock (v1.1 §C `ta-adv-topup-qr-remain`) */
export function formatRemainLong(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
}

/** the admin looking at the row — only the id and the roles matter for the action rules */
export interface TopupViewer {
  id: string | null
  roles: AdminRole[]
}

/**
 * Which controls the row renders (v1.1 §C). Exactly one of `pay` / `open` is ever true; `recheck` comes with
 * `pay` on `notFound`, `release` is the GOD-only lease breaker of someone else's `paying` round.
 */
export interface TopupRowActions {
  /** start a new round: "จ่ายเงิน", or "ลองใหม่" when `retry` */
  pay: boolean
  /** the pay button is a retry of a failed round (same amount prefilled) */
  retry: boolean
  /** `claim` + pay modal ("Ready to pay" / re-open my own `paying` round) */
  open: boolean
  /** GOD breaks someone else's lease ("ปลดการจอง", AC-19) */
  release: boolean
  /** "ตรวจอีกครั้ง" on a `notFound` round (AC-8b / D15) */
  recheck: boolean
}

const NO_ACTIONS: TopupRowActions = { pay: false, retry: false, open: false, release: false, recheck: false }

/** only GOD and Payment may change a round; Admin is read-only (spec D17) */
export function canPayTopups(viewer: TopupViewer): boolean {
  return viewer.roles.includes('GOD') || viewer.roles.includes('Payment')
}

export function canReleaseTopups(viewer: TopupViewer): boolean {
  return viewer.roles.includes('GOD')
}

export function topupRowActions(topup: TopupView | null | undefined, viewer: TopupViewer): TopupRowActions {
  if (!canPayTopups(viewer)) return NO_ACTIONS

  if (!topup) return { ...NO_ACTIONS, pay: true }

  switch (topup.status) {
    case 'qrFailed':
      return { ...NO_ACTIONS, pay: true, retry: true }
    case 'expired':
    case 'paid':
      return { ...NO_ACTIONS, pay: true }
    case 'notFound':
      return { ...NO_ACTIONS, pay: true, recheck: true }
    case 'readyToPay':
      return { ...NO_ACTIONS, open: true }
    case 'paying':
      return topup.payingBy && viewer.id && topup.payingBy.id === viewer.id
        ? { ...NO_ACTIONS, open: true }
        : { ...NO_ACTIONS, release: canReleaseTopups(viewer) }
    // waitingQr and verifying are worker/scheduler territory — the row only shows a badge
    default:
      return NO_ACTIONS
  }
}

/** the amount a retry starts from (L-2: a new round with the amount of the failed one) */
export function retryAmount(topup: TopupView | null | undefined): number | undefined {
  return topup && Number.isInteger(topup.amount) ? topup.amount : undefined
}

/** "ตรวจแล้ว 3 ครั้ง · ล่าสุด 12:35" (+ the error of the last check) — `ta-adv-topup-check-info` */
export function topupCheckInfo(topup: TopupView | null | undefined): string {
  if (!topup) return ''
  const parts: string[] = [`ตรวจแล้ว ${topup.checkCount ?? 0} ครั้ง`]
  if (topup.lastCheckAt) parts.push(`ล่าสุด ${formatClock(topup.lastCheckAt)}`)
  if (topup.error) parts.push(topup.error)
  return parts.join(' · ')
}

/** "1,000.00 THB" — the balance the worker read after `paid` */
export function topupBalanceText(topup: TopupView | null | undefined): string {
  if (!topup?.balanceAmount) return ''
  return topup.balanceCurrency ? `${topup.balanceAmount} ${topup.balanceCurrency}` : topup.balanceAmount
}

/** integer baht ≥ `TOPUP_MIN_AMOUNT`; the message mirrors the API's 400 text (api-contract §4) */
export function topupAmountError(amount: number | undefined | null): string | null {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return 'กรอกจำนวนเงิน'
  if (!Number.isInteger(amount) || amount < TOPUP_MIN_AMOUNT) {
    return `amount ต้องเป็นจำนวนเต็มตั้งแต่ ${TOPUP_MIN_AMOUNT} บาท`
  }
  return null
}
