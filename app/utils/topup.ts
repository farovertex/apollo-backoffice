/**
 * FEAT-021 — presentation rules of one top-up round, shared by the advertisers slide-over (`ta-adv-topup-*`)
 * and the `/topups` page (`tp-row-*`). api-contract.md v1 §3/§4 and the **v1.1 addendum §C** decide which
 * element a row renders; this file is the single implementation of that table so the two surfaces can never
 * drift apart.
 *
 * Nothing here talks to the API and nothing invents a state: the API owns the status, the BO owns the words.
 * FEAT-029 adds the two words of an auto round: `topupTrigger()` (missing field ⇒ `manual`) and
 * `topupRequesterName()` (`requestedBy: null` ⇒ "ระบบ").
 *
 * FEAT-051 (api-contract v1 §1/§6, spec "UI behaviour") adds the **card channel** on top of exactly the same
 * table: `topupChannel()` reads a missing `channel` as `qr`, the three new states get a badge, and
 * `topupRowActions()` learns three buttons (`approve` / `cancel` / `otp`). **Every QR rule above is untouched**
 * (AC-31): `topupAmountError(amount)` with one argument still answers with the QR minimum, and no existing
 * function changed its name, its signature or its result.
 *
 * FEAT-053 (api-contract v1 §1/§3, AC-19/AC-22) — the numbers stop being hardcoded: `topupCardLimit()`,
 * `topupQrMinAmount()` and `topupRemainingToday()` read what `GET /topups/options` sent (`useTopupOptions`) and
 * fall back to `TOPUP_CARD_LIMITS` / `TOPUP_MIN_AMOUNT` **silently** when it did not answer, so every FEAT-051
 * rule still holds when the new endpoint is down. `accountAutoTopupChannel()` reads the account's auto channel.
 */
import type { AdminRole } from '#shared/types/auth'
import type { PaymentCardView } from '#shared/types/payment-cards'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'
import type { TopupCardLimit, TopupCardSnapshot, TopupChannel, TopupOptionsResponse, TopupStatus, TopupTrigger, TopupView } from '#shared/types/topups'

/** `TOPUP_MIN_AMOUNT` of the API (api-contract §1). The API's 400 body stays the authority — this is the hint. */
export const TOPUP_MIN_AMOUNT = 400

/**
 * FEAT-051 — the **default** `TOPUP_CARD_LIMITS` of the API (api-contract §3), mirrored here as a hint only.
 *
 * FEAT-053 — `GET /topups/options` is now the source of these numbers (`useTopupOptions`), and this table is
 * only the **fallback** used when that request did not answer 200 (spec assumption 9: the FEAT-051 UI rules keep
 * working byte for byte when the new endpoint is down). Nothing else reads it directly — go through
 * `topupCardLimit()` / `topupQrMinAmount()`.
 */
export const TOPUP_CARD_LIMITS: Record<string, { min: number, maxPerRound: number }> = {
  USD: { min: 10, maxPerRound: 500 },
  THB: { min: 400, maxPerRound: 20_000 }
}

/** the per-round rule the popover validates against: `min`/`maxPerRound` only (the per-day cap is the API's) */
export interface TopupRoundLimit {
  min: number
  maxPerRound: number
}

/**
 * FEAT-053 — the card limits of one currency: the server's table when `GET /topups/options` answered, else the
 * fallback above. `null` = that currency has no card channel at all (same meaning as before).
 */
export function topupCardLimit(
  currency: string | null | undefined,
  options?: TopupOptionsResponse | null
): TopupRoundLimit | null {
  const key = (currency ?? '').toUpperCase()
  if (!key) return null
  const fromApi = options?.card?.limits?.[key]
  if (fromApi) return { min: fromApi.min, maxPerRound: fromApi.maxPerRound }
  // the endpoint answered and simply does not list this currency → no card channel (do not fall back)
  if (options?.card?.limits) return null
  return TOPUP_CARD_LIMITS[key] ?? null
}

/**
 * FEAT-053 — `qr.minAmount` of the server, falling back to the hardcoded `TOPUP_MIN_AMOUNT`.
 *
 * TASK-topup-min-currency (2026-10-16): the QR minimum follows the **account's currency**, same rule as the card
 * channel (`min` of that currency's limits row; USD → 10). Order of truth:
 *   1. the server answered **for this account** (`card.account` present) → `qr.minAmount` is already per currency;
 *   2. a currency is known → `min` of that currency's row (the server's table when it answered, else the fallback);
 *   3. otherwise the server's global `qr.minAmount`, else `TOPUP_MIN_AMOUNT` (THB, the old behaviour).
 * Mirrors `qrMinAmountFor()` in the API — change one, change the other.
 */
export function topupQrMinAmount(options?: TopupOptionsResponse | null, currency?: string | null): number {
  const perAccount = options?.card?.account ? options.qr?.minAmount : undefined
  if (Number.isInteger(perAccount)) return perAccount as number
  const key = (currency ?? '').toUpperCase()
  if (key) {
    const row = options?.card?.limits ? options.card.limits[key] : TOPUP_CARD_LIMITS[key]
    if (row && Number.isInteger(row.min)) return row.min
  }
  const min = options?.qr?.minAmount
  return Number.isInteger(min) ? (min as number) : TOPUP_MIN_AMOUNT
}

/**
 * TASK-topup-min-currency — the lowest QR minimum over every currency (10 with the default table): the floor of a
 * number input that serves accounts of **mixed or unknown** currencies (the bulk modal). The API's per-row 400 is
 * the real check; this only stops the browser from refusing a valid 10 USD before the handler runs.
 */
export function topupQrMinFloor(options?: TopupOptionsResponse | null): number {
  const table = options?.card?.limits ?? TOPUP_CARD_LIMITS
  const mins = Object.values(table).map(row => row.min).filter(Number.isInteger)
  return Math.min(topupQrMinAmount(options), ...mins)
}

/** unit word of the QR-minimum message: THB and "unknown" keep the historical `บาท`, any other currency its ISO code */
export function topupQrUnit(currency?: string | null): string {
  const key = (currency ?? '').toUpperCase()
  return key && key !== 'THB' ? key : 'บาท'
}

/** FEAT-053 — the whole limit row of the account's currency (incl. `maxPerDay`/`autoAmount`), API only */
export function topupAccountLimit(options?: TopupOptionsResponse | null): TopupCardLimit | null {
  return options?.card?.account?.limit ?? null
}

/**
 * FEAT-053 (AC-22) — how much of the per-day cap is left for this account+currency, or `null` when there is no
 * cap (`maxPerDay: null`) or the options could not be read. `null` ⇒ the "เหลือวันนี้" line is not rendered.
 */
export function topupRemainingToday(options?: TopupOptionsResponse | null): number | null {
  const remaining = options?.card?.account?.remainingToday
  return typeof remaining === 'number' ? remaining : null
}

/** FEAT-053 — "เหลือวันนี้ 100 USD" */
export function remainingTodayText(remaining: number, currency: string | null | undefined): string {
  return currency ? `เหลือวันนี้ ${formatInt(remaining)} ${currency}` : `เหลือวันนี้ ${formatInt(remaining)}`
}

/**
 * FEAT-053 — the auto top-up channel of an account: a row written before the feature (and an API that predates
 * it) reads `qr`, exactly like the API's schema default (api-contract §3).
 */
export function accountAutoTopupChannel(
  account: Pick<TikTokAccount, 'autoTopupChannel'> | null | undefined
): TopupChannel {
  return account?.autoTopupChannel === 'card' ? 'card' : 'qr'
}

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
  expired: { label: 'QR หมดอายุ', color: 'neutral' },
  // FEAT-051 (spec "UI behaviour") — the three states of the card channel
  pendingApproval: { label: 'รออนุมัติ', color: 'neutral' },
  awaitingOtp: { label: 'รอ OTP', color: 'warning' },
  cardFailed: { label: 'จ่ายด้วยบัตรไม่สำเร็จ', color: 'error' }
}

/** FEAT-051 — the word on the channel badge / the channel chooser */
export const TOPUP_CHANNEL_LABEL: Record<TopupChannel, string> = {
  qr: 'QR',
  card: 'บัตร'
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

/** FEAT-051 — milliseconds left on the approval clock (`approvalExpiresAt`, `TOPUP_APPROVAL_TTL_HOURS`) */
export function approvalRemainingMs(topup: TopupView | null | undefined, now = Date.now()): number {
  if (!topup || topup.status !== 'pendingApproval') return 0
  return remainingMs(topup.approvalExpiresAt, now)
}

/** FEAT-051 — milliseconds left on the bank's OTP (`humanTask.expiresAt`, `TOPUP_OTP_WAIT_MS`) */
export function otpRemainingMs(topup: TopupView | null | undefined, now = Date.now()): number {
  return remainingMs(topup?.humanTask?.expiresAt, now)
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
  /** FEAT-051 — "จ่ายเงิน" on a `pendingApproval` card round: the confirm dialog → `POST /topups/:id/approve` */
  approve: boolean
  /** FEAT-051 — "ยกเลิก" a `pendingApproval` card round → `POST /topups/:id/cancel` */
  cancel: boolean
  /** FEAT-051 — "กรอก OTP" on an `awaitingOtp` round → the OTP modal */
  otp: boolean
}

const NO_ACTIONS: TopupRowActions = {
  pay: false,
  retry: false,
  open: false,
  release: false,
  recheck: false,
  approve: false,
  cancel: false,
  otp: false
}

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
      // FEAT-051 — a card round in `paying` is the worker's: there is no lease, no QR and no claim to break
      if (topupChannel(topup) === 'card') return NO_ACTIONS
      return topup.payingBy && viewer.id && topup.payingBy.id === viewer.id
        ? { ...NO_ACTIONS, open: true }
        : { ...NO_ACTIONS, release: canReleaseTopups(viewer) }
    // FEAT-051 (spec "UI behaviour", AC-34)
    case 'pendingApproval':
      return { ...NO_ACTIONS, approve: true, cancel: true }
    case 'awaitingOtp':
      return { ...NO_ACTIONS, otp: true }
    case 'cardFailed':
      return { ...NO_ACTIONS, pay: true, retry: true }
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

/** what the round tops up: the advertiser's name, or for an account-level round the BC name / account label */
export function topupTargetName(topup: TopupView | null | undefined): string {
  if (!topup) return ''
  if (topup.level === 'account') return topup.account?.bcOrgName || topup.account?.label || 'BC'
  return topup.advertiser?.name ?? ''
}

/** FEAT-029 — ชื่อคนขอรอบ: `requestedBy === null` ⇔ รอบที่ระบบเปิดเอง (trigger `auto`) */
export function topupRequesterName(topup: Pick<TopupView, 'requestedBy'> | null | undefined): string {
  if (!topup) return REPORT_DASH
  return topup.requestedBy ? topup.requestedBy.displayName || REPORT_DASH : 'ระบบ'
}

/** FEAT-029 — `manual` for rows written before the field existed */
export function topupTrigger(topup: Pick<TopupView, 'trigger'> | null | undefined): TopupTrigger {
  return topup?.trigger === 'auto' ? 'auto' : 'manual'
}

// ── FEAT-051 · channel and card ──────────────────────────────────────────────────────────────────────────────────────

/** `qr` for every round that does not say otherwise — rows written before the feature included (AC-1) */
export function topupChannel(topup: Pick<TopupView, 'channel'> | null | undefined): TopupChannel {
  return topup?.channel === 'card' ? 'card' : 'qr'
}

/** the card of a round, `null` on a QR round (or on an API that predates the feature) */
export function topupCard(topup: TopupView | null | undefined): TopupCardSnapshot | null {
  return topup?.card ?? null
}

const CARD_BRAND_LABEL: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'Amex',
  jcb: 'JCB',
  unionpay: 'UnionPay',
  discover: 'Discover',
  unknown: 'บัตร'
}

/** `mastercard` → `Mastercard`; an unknown brand is shown as the API sent it (never empty) */
export function cardBrandLabel(brand: string | null | undefined): string {
  if (!brand) return 'บัตร'
  return CARD_BRAND_LABEL[brand.toLowerCase()] ?? brand
}

/** `****9706` */
export function cardMask(last4: string | null | undefined): string {
  return `****${last4 ?? '????'}`
}

/** `Mastercard ****9706 · NARUTCHAI SOMBUN (10/29)` — the one line the modal, the dialog and the row share */
export function cardSummary(card: TopupCardSnapshot | PaymentCardView | null | undefined): string {
  if (!card) return ''
  const parts = [`${cardBrandLabel(card.brand)} ${cardMask(card.last4)}`]
  if (card.holderName) parts.push(card.holderName)
  return card.expiry ? `${parts.join(' · ')} (${card.expiry})` : parts.join(' · ')
}

/** a card the API would accept for a new round: `removed` and `expired` cards are not offered */
export function isUsableCard(card: PaymentCardView): boolean {
  return card.status !== 'removed' && card.status !== 'expired'
}

/** the card the pay modal starts with: the default one, else the newest usable one */
export function pickDefaultCard(cards: PaymentCardView[] | null | undefined): PaymentCardView | null {
  const usable = (cards ?? []).filter(isUsableCard)
  return usable.find(c => c.isDefault) ?? usable[0] ?? null
}

/**
 * Why the card channel cannot be used for this account, or `null` when it can (as far as the BO can tell).
 *  - `undefined` → the surface does not know the account's currency: the option stays enabled and the API's own
 *    409/400 text is what the admin reads (the BO never invents a reason).
 *  - `null`       → the account has no `balanceCurrency` yet (AC-5, the API answers 409).
 *  - a currency the server has no limits for → the API answers 400 (AC-6).
 *
 * FEAT-053: the list of supported currencies comes from `GET /topups/options` when it answered; the wording is
 * unchanged (AC-22: "ข้อความเดิมของ FEAT-051 เป๊ะ", only the numbers/currencies behind it are the server's).
 */
export function cardChannelBlockedReason(
  currency: string | null | undefined,
  options?: TopupOptionsResponse | null
): string | null {
  if (currency === undefined) return null
  if (!currency) return 'ยังไม่รู้สกุลเงินของบัญชีนี้ — กด Sync หรืออ่านยอดคงเหลือก่อน'
  if (!topupCardLimit(currency, options)) return `ช่องทางบัตรไม่รองรับสกุลเงิน ${currency}`
  return null
}

/** digits only — spaces and dashes of a typed card number / expiry are not part of the value */
export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '')
}

/** 13–19 digits (api-contract §1); the message is a hint, the API's 400 is the authority */
export function cardNumberError(value: string): string | null {
  const digits = onlyDigits(value)
  if (!digits) return 'กรอกหมายเลขบัตร'
  if (digits.length < 13 || digits.length > 19) return 'หมายเลขบัตรต้องเป็นตัวเลข 13–19 หลัก'
  return null
}

/** `MM/YY`, not in the past (AC-30 is the API's; this is the hint that saves a round trip) */
export function cardExpiryError(value: string, now = new Date()): string | null {
  const digits = onlyDigits(value)
  if (!digits) return 'กรอกวันหมดอายุ (MM/YY)'
  if (digits.length !== 4) return 'วันหมดอายุต้องเป็น MM/YY'
  const month = Number(digits.slice(0, 2))
  const year = 2000 + Number(digits.slice(2))
  if (month < 1 || month > 12) return 'เดือนต้องเป็น 01–12'
  // a card is valid through the last day of its month
  const endOfMonth = new Date(year, month, 1).getTime()
  if (endOfMonth <= now.getTime()) return 'บัตรหมดอายุแล้ว'
  return null
}

/** 3–4 digits */
export function cardCvvError(value: string): string | null {
  const digits = onlyDigits(value)
  if (!digits) return 'กรอก CVV/CVC'
  if (digits.length < 3 || digits.length > 4) return 'CVV/CVC ต้องเป็นตัวเลข 3–4 หลัก'
  return null
}

/** required, ≤ 64 (api-contract §1) */
export function cardHolderError(value: string): string | null {
  const name = (value ?? '').trim()
  if (!name) return 'กรอกชื่อผู้ถือบัตร'
  if (name.length > 64) return 'ชื่อผู้ถือบัตรยาวเกิน 64 ตัวอักษร'
  return null
}

/** `4111…` → `visa`; only used for the live brand hint next to the number field, never sent to the API */
export function cardBrandFromNumber(value: string): string | null {
  const digits = onlyDigits(value)
  if (digits.length < 2) return null
  if (digits.startsWith('4')) return 'visa'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard'
  if (digits.startsWith('35')) return 'jcb'
  if (digits.startsWith('62')) return 'unionpay'
  return null
}

/** the last 4 digits of what is being typed (the confirm dialog shows them; the number itself never travels) */
export function cardLast4FromNumber(value: string): string {
  const digits = onlyDigits(value)
  return digits.slice(-4)
}

/** "400.00 THB" — ยอดคงเหลือหลังบวกเงินฝากที่ตรวจผ่าน */
export function balanceText(amount: string | null | undefined, currency: string | null | undefined): string {
  if (!amount) return ''
  return currency ? `${amount} ${currency}` : amount
}

/** ยอดคงเหลือที่เขียนลงรอบตอน `paid` */
export function topupBalanceText(topup: TopupView | null | undefined): string {
  return balanceText(topup?.balanceAmount, topup?.balanceCurrency)
}

/**
 * integer baht ≥ `TOPUP_MIN_AMOUNT`; the message mirrors the API's 400 text (api-contract §4).
 *
 * FEAT-051: called with **one argument it is the QR rule, byte for byte as before** (AC-1/AC-31). With
 * `{ channel: 'card', currency }` it uses the per-currency `min`/`maxPerRound` instead (AC-6: USD 10 must pass
 * without tripping the QR minimum of 400). An unknown currency has no local rule — only "an integer" is checked
 * and the API's 400/409 decides the rest.
 *
 * FEAT-053 (AC-22): `limit` / `qrMin` carry the numbers `GET /topups/options` sent. **The two messages are
 * unchanged** — only the numbers inside them may now come from the server instead of the fallback table.
 */
export function topupAmountError(
  amount: number | undefined | null,
  options?: { channel?: TopupChannel, currency?: string | null, limit?: TopupRoundLimit | null, qrMin?: number }
): string | null {
  if (amount === undefined || amount === null || Number.isNaN(amount)) return 'กรอกจำนวนเงิน'

  if (options?.channel === 'card') {
    if (!Number.isInteger(amount) || amount <= 0) return 'amount ต้องเป็นจำนวนเต็ม'
    const currency = (options.currency ?? '').toUpperCase()
    const limits = options.limit !== undefined ? options.limit : (currency ? TOPUP_CARD_LIMITS[currency] : undefined)
    if (!limits) return null
    if (amount < limits.min || amount > limits.maxPerRound) {
      return `amount ต้องเป็นจำนวนเต็ม ${limits.min}–${limits.maxPerRound} ${currency}`
    }
    return null
  }

  // TASK-topup-min-currency: the QR minimum and its unit follow the account's currency (`qrMin` is computed by the
  // caller via `topupQrMinAmount(options, currency)`); THB and "unknown" keep the historical message byte for byte
  const qrMin = Number.isInteger(options?.qrMin) ? (options?.qrMin as number) : TOPUP_MIN_AMOUNT
  if (!Number.isInteger(amount) || amount < qrMin) {
    return `amount ต้องเป็นจำนวนเต็มตั้งแต่ ${qrMin} ${topupQrUnit(options?.currency)}`
  }
  return null
}
