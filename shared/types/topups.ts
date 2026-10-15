/**
 * FEAT-021 — top-up v2. Mirrors
 * mission-control/.ai/features/FEAT-021-topup-flow-v2-qr-queue-claim-verify-realtime/api-contract.md
 * **v1 §3 (views) / §4 (endpoints) / §5 (SSE)** and the **v1.1 addendum §B**.
 *
 * One document per round lives in the API collection `topups`; the BO only ever sees `TopupView`, which
 * never carries `qrImage` — the image comes back exactly once, in the 200 body of `POST /topups/:id/claim`
 * (and from `GET /topups/:id/qr` for the admin holding the lease).
 *
 * FEAT-029 (api-contract.md v1 §4): a round carries `trigger` (`manual` | `auto`) and `requestedBy` is
 * `null` for a round the system opened on its own (auto top-up) — every other key behaves as before.
 *
 * FEAT-051 (api-contract.md v1 §1/§6): a round also carries a **channel** (`qr` | `card`). Everything the card
 * channel adds is optional here on purpose — a row written before the feature (and an API that predates it) has
 * none of the keys, and `topupChannel()` / `topupCard()` in `app/utils/topup.ts` read a missing `channel` as `qr`
 * (AC-1). No key of the card channel ever carries a secret: the view knows `brand`/`last4`/`expiry`/`holderName`
 * and nothing else (api-contract §6, AC-24).
 */
import type { ApiErrorBody } from './auth'

/**
 * `topups.status` — the state machine of one round (spec "สถานะของหนึ่งรอบ").
 * FEAT-051 adds the three states of the card channel: `pendingApproval` (waiting for a human to press
 * "จ่ายเงิน"), `awaitingOtp` (the bank asked for a code) and `cardFailed` (a round that died **before** the
 * payment button was pressed).
 */
export type TopupStatus
  = 'waitingQr'
    | 'qrFailed'
    | 'readyToPay'
    | 'paying'
    | 'verifying'
    | 'paid'
    | 'notFound'
    | 'expired'
    | 'pendingApproval'
    | 'awaitingOtp'
    | 'cardFailed'

/** FEAT-051 — how the round is paid: the QR of the payment page, or a credit/debit card of that account. */
export type TopupChannel = 'qr' | 'card'

/** an admin as the API embeds it (`requestedBy`, `payingBy`, `confirmedBy`) */
export interface TopupActor {
  id: string
  displayName: string
}

/**
 * FEAT-029 — who opened the round: `manual` = a human pressed "จ่ายเงิน" (`POST /topups`), `auto` = the kpi
 * job saw a balance below `autoTopup.minBalance` and opened it. Rows written before the feature read `manual`.
 */
export type TopupTrigger = 'manual' | 'auto'

/**
 * `advertiser` = a round paid on one advertiser's payment page (FEAT-021).
 * `account` = a round paid on the Business Center payment page of the TikTok account — TikTok shares one balance
 * across the whole BC, so there is no advertiser (`advertiserId` / `advertiser` are null).
 */
export type TopupLevel = 'advertiser' | 'account'

/**
 * FEAT-051 (api-contract §6) — the copy of the card a round was started with. **No secret**: the full number,
 * the CVV and the ciphertext never leave the API.
 */
export interface TopupCardSnapshot {
  cardId: string
  /** `visa` | `mastercard` | `amex` | `unknown` — guessed from the number by the API */
  brand: string
  last4: string
  /** `MM/YY` */
  expiry: string
  holderName: string
}

/** FEAT-051 (api-contract §6) — the open `paymentOtp` task of a round in `awaitingOtp`, `null` when there is none */
export interface TopupHumanTaskRef {
  id: string
  kind: 'paymentOtp'
  /** ISO — `TOPUP_OTP_WAIT_MS` after the task was created; the OTP modal counts down to it */
  expiresAt: string
}

/** api-contract §3.1 — the one view used by the list, the detail, the stream, `advertiser.topup` and `account.topup`. */
export interface TopupView {
  id: string
  workspaceId: string
  level: TopupLevel
  tiktokAccountId: string
  /** null when `level === 'account'` */
  advertiserId: string | null
  /** `tiktokAdvertiserId` is masked to `****1234` by the API for Admin — the BO shows what it gets · null when `level === 'account'` */
  advertiser: { id: string, name: string, tiktokAdvertiserId: string } | null
  /** TASK-account-label (2026-10-14) — `loginEmail` joined `label` so the BO can fall back when there is no label */
  account: { id: string, label: string | null, loginEmail: string | null, bcOrgName: string | null }
  /** BC `org_id` of an account-level round */
  bcOrgId: string | null
  amount: number
  currency: string
  status: TopupStatus
  active: boolean
  /** ISO | null */
  qrSavedAt: string | null
  /** ISO | null — the 24 h clock of the QR */
  qrExpiresAt: string | null
  payingBy: TopupActor | null
  payingAt: string | null
  /** ISO | null — the 5 min claim lease */
  payingExpiresAt: string | null
  confirmedBy: TopupActor | null
  confirmedAt: string | null
  verifyDeadlineAt: string | null
  nextCheckAt: string | null
  lastCheckAt: string | null
  checkCount: number
  paidAt: string | null
  balanceAmount: string | null
  balanceCurrency: string | null
  /** `qrFailed` reason, or the error of the last check — shown as-is (Thai) */
  error: string | null
  /** FEAT-029 — `manual` for a human round, `auto` for one the system opened */
  trigger: TopupTrigger
  /** FEAT-029 — `null` ⇔ `trigger: 'auto'` (the BO shows "ระบบ"); a manual round always carries the admin */
  requestedBy: TopupActor | null
  requestedAt: string
  createdAt: string
  updatedAt: string
  /** FEAT-051 — `qr` | `card`; **missing ⇒ `qr`** (every row written before the feature) */
  channel?: TopupChannel
  /** FEAT-051 — the card of this round; null/missing on a QR round */
  card?: TopupCardSnapshot | null
  /** FEAT-051 — who pressed "จ่ายเงิน" on this round; null = not approved yet (`pendingApproval`) */
  approvedBy?: TopupActor | null
  approvedAt?: string | null
  /** FEAT-051 — ISO | null: when a `pendingApproval` round dies on its own (`TOPUP_APPROVAL_TTL_HOURS`) */
  approvalExpiresAt?: string | null
  /** FEAT-051 — the open `paymentOtp` task while the round is `awaitingOtp` */
  humanTask?: TopupHumanTaskRef | null
}

/** `scope` of `GET /topups` */
export type TopupScope = 'active' | 'all'

/** `GET /topups` 200 */
export interface TopupsResponse {
  topups: TopupView[]
  page: number
  limit: number
  total: number
  activeCount: number
}

/**
 * FEAT-051 (api-contract §1) — the card the admin typed, sent **once**, on the round that saves it.
 * It exists for the length of one request: never stored, never logged, never put in a data attribute (AC-24).
 */
export interface TopupCardInput {
  /** 13–19 digits; spaces and dashes are stripped before it is sent */
  number: string
  /** `MM/YY` */
  expiry: string
  /** 3–4 digits */
  cvv: string
  holderName: string
}

/** FEAT-051 — the keys both create endpoints share (api-contract §1/§2) */
export interface TopupChannelBody {
  /** omitted ⇒ `qr`, which must behave exactly as before the feature (AC-1) */
  channel?: TopupChannel
  /** `false` = leave the round in `pendingApproval` for somebody else to approve (card only) */
  approve?: boolean
  /** the saved card to use; omitted ⇒ the account's default card */
  cardId?: string
  /** the card to save and use (first payment of that account, or "ใช้บัตรใบอื่น") */
  card?: TopupCardInput
}

/** `POST /topups` body (advertiser level) */
export interface TopupCreateBody extends TopupChannelBody {
  tiktokAccountId: string
  advertiserId: string
  amount: number
}

/** `POST /topups` 201 — FEAT-051: `jobId` is `null` for a round created with `approve: false` */
export interface TopupCreateResponse {
  topup: TopupView
  jobId: string | null
}

/** `POST /topups/accounts` body — one amount for every account (one round + one pay job per account) */
export interface AccountTopupBody extends TopupChannelBody {
  tiktokAccountIds: string[]
  amount: number
}

/** one row of `POST /topups/accounts` 200 — an account that could not start does not fail the others */
export interface AccountTopupResult {
  tiktokAccountId: string
  ok: boolean
  topup: TopupView | null
  jobId: string | null
  /** the API's own text (Thai) when `ok` is false */
  error: string | null
}

export interface AccountTopupResponse {
  results: AccountTopupResult[]
}

/** `POST /topups/accounts/:id/balance` 202 — `reused` = a balance job of this account was already queued */
export interface AccountBalanceResponse {
  jobId: string
  reused: boolean
}

/** `POST /topups/:id/claim` 200 — the only place the QR image travels */
export interface TopupClaimResponse {
  topup: TopupView
  qrImage: string
}

/** `POST /topups/:id/cancel|confirm|release|recheck` 2xx */
export interface TopupMutationResponse {
  topup: TopupView
  jobId?: string
}

/** 409 of `claim` (api-contract §4): the API adds who holds the lease and until when */
export interface TopupClaimConflictBody extends ApiErrorBody {
  payingBy?: TopupActor | null
  payingExpiresAt?: string | null
  status?: TopupStatus
}

/** `event: ready` of `GET /topups/stream` (api-contract §5) */
export interface TopupReadyEvent {
  at: string
}

/** what `useTopupsLive` reports about its connection (v1.1 §B, `tp-live[data-mode]`) */
export type TopupLiveMode = 'connecting' | 'live' | 'polling'
