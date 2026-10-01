/**
 * FEAT-021 — top-up v2. Mirrors
 * mission-control/.ai/features/FEAT-021-topup-flow-v2-qr-queue-claim-verify-realtime/api-contract.md
 * **v1 §3 (views) / §4 (endpoints) / §5 (SSE)** and the **v1.1 addendum §B**.
 *
 * One document per round lives in the API collection `topups`; the BO only ever sees `TopupView`, which
 * never carries `qrImage` — the image comes back exactly once, in the 200 body of `POST /topups/:id/claim`
 * (and from `GET /topups/:id/qr` for the admin holding the lease).
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

/** api-contract §3.1 — the one view used by the list, the detail, the stream and `advertiser.topup`. */
export interface TopupView {
  id: string
  workspaceId: string
  tiktokAccountId: string
  advertiserId: string
  /** `tiktokAdvertiserId` is masked to `****1234` by the API for Admin — the BO shows what it gets */
  advertiser: { id: string, name: string, tiktokAdvertiserId: string }
  account: { id: string, label: string }
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
  requestedBy: TopupActor
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
