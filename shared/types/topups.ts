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
 */
import type { ApiErrorBody } from './auth'

/** `topups.status` — the state machine of one round (spec "สถานะของหนึ่งรอบ"). */
export type TopupStatus
  = 'waitingQr'
    | 'qrFailed'
    | 'readyToPay'
    | 'paying'
    | 'verifying'
    | 'paid'
    | 'notFound'
    | 'expired'

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
  account: { id: string, label: string | null, bcOrgName: string | null }
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

/** `POST /topups` 201 */
export interface TopupCreateResponse {
  topup: TopupView
  jobId: string
}

/** `POST /topups/accounts` body — one amount for every account (one round + one pay job per account) */
export interface AccountTopupBody {
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
