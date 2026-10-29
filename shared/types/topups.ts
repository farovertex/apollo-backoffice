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
 * FEAT-053 (api-contract.md v1 §1): `GET /topups/options` tells the BO the server's real per-currency card
 * limits (`TopupOptionsResponse`), which replaces the table the BO used to mirror by hand.
 *
 * FEAT-051 (api-contract.md v1 §1/§6): a round also carries a **channel** (`qr` | `card`). Everything the card
 * channel adds is optional here on purpose — a row written before the feature (and an API that predates it) has
 * none of the keys, and `topupChannel()` / `topupCard()` in `app/utils/topup.ts` read a missing `channel` as `qr`
 * (AC-1). No key of the card channel ever carries a secret: the view knows `brand`/`last4`/`expiry`/`holderName`
 * and nothing else (api-contract §6, AC-24).
 */
import type { MonitorUtm } from '#shared/types/ads-monitor'
import type { ApiErrorBody } from './auth'
import type { TopupFxView } from './fx'

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
 * FEAT-072 (api-contract v1 §1.1) — the round's workspace, resolved to its owner's display name. `id` is
 * always `workspaceId`; `name`/`ownerName` are `null` once the workspace row or its owner admin is gone.
 */
export interface TopupWorkspaceRef {
  id: string
  name: string | null
  ownerName: string | null
}

/**
 * FEAT-072 (api-contract v1 §1.2) — one resolved ad of `TopupSource.primary`. Internal ids are our own
 * (`advertiserId` is never the TikTok aadvid — no masking, api-contract §2 "Permissions"); `coverUrl` is the
 * signed CDN link of the last kpi fetch and may expire (`ReportsAdThumb` already handles that).
 */
export interface TopupSourceAd {
  adId: string
  tiktokCreativeId: string
  creativeName: string
  coverUrl: string | null
  isVideo: boolean
  campaignName: string
  tiktokCampaignId: string
  advertiserId: string
  tiktokAccountId: string
}

/**
 * FEAT-072 (api-contract v1 §1.2) — "มาจาก ads ไหน" of an auto round: the switched-on ads of the account at
 * the moment the round was opened (rule S1). `null` ⇔ the row has no `cause` (every manual round; every auto
 * round written before FEAT-072). `primary` is `compareFirstAd`-first; `adCount` is the **stored** count
 * (`cause.adIds.length`), which may be larger than the number of ids that still resolved to a row.
 */
export interface TopupSource {
  primary: TopupSourceAd | null
  adCount: number
  utm: MonitorUtm | null
}

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

/** FEAT-077 (api-contract v1 §6.3) — where a Telegram round is: decided (`pending`), posted (`sent`), or back in the BO (`failed`) */
export type TopupTelegramStatus = 'pending' | 'sent' | 'failed'

/** FEAT-077 — what the group message currently shows */
export type TopupTelegramBadge = 'none' | 'paid' | 'expired' | 'notFound'

/**
 * FEAT-077 (api-contract v1 §6.3) — the Telegram block of a QR round whose prefix is linked to a group.
 * `null` (or missing on an API/stub that predates the feature) = not a Telegram round → the BO renders exactly as before.
 * Never carries `chatId`, `messageId` or the raw error object.
 */
export interface TopupTelegram {
  status: TopupTelegramStatus
  chatTitle: string | null
  /** ISO | null — when the QR was posted to the group */
  sentAt: string | null
  badge: TopupTelegramBadge
  /** who pressed "แจ้งจ่ายแล้ว" in the group (`@username` or first name) */
  paidPressedBy: { name: string, at: string } | null
  /** the client's error kind + Telegram's description (no secret by construction) */
  lastError: string | null
}

/** api-contract §3.1 — the one view used by the list, the detail, the stream, `advertiser.topup` and `account.topup`. */
export interface TopupView {
  id: string
  workspaceId: string
  /**
   * FEAT-072 (api-contract v1 §1.1) — the resolved workspace + owner, always present on the wire. Optional
   * here so the page tolerates an API/stub that predates this feature (reads like `undefined` → no owner,
   * same as `null`), same spirit as the FEAT-051 optional keys below.
   */
  workspace?: TopupWorkspaceRef
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
  /** FEAT-080 — rate stamped when the round became `paid`; `null` otherwise / paid before the feature / no rate that day */
  fx: TopupFxView | null
  /** `qrFailed` reason, or the error of the last check — shown as-is (Thai) */
  error: string | null
  /** FEAT-029 — `manual` for a human round, `auto` for one the system opened */
  trigger: TopupTrigger
  /** FEAT-029 — `null` ⇔ `trigger: 'auto'` (the BO shows "ระบบ"); a manual round always carries the admin */
  requestedBy: TopupActor | null
  requestedAt: string
  /**
   * FEAT-072 (api-contract v1 §1.2) — "มาจาก ads ไหน" of an auto round, always present on the wire. Optional
   * here for the same reason as `workspace` above: an API/stub without the key must render like `null`.
   */
  source?: TopupSource | null
  /**
   * FEAT-077 (api-contract v1 §6.3) — 41st key, right after `source`. Optional for the same reason as `source`:
   * missing ⇒ read like `null` (not a Telegram round).
   */
  telegram?: TopupTelegram | null
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
  /**
   * FEAT-077 (api-contract v1 §6.1) — `false` = keep this manual QR round in the BO although the account's prefix is
   * linked to a Telegram group. The BO sends the key **only** as `false` (switch off); absent = `true`.
   */
  sendTelegram?: boolean
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

/**
 * FEAT-053 (api-contract §1) — one currency's card limits as `GET /topups/options` sends them.
 * `maxPerDay` / `autoAmount` are `null` when the server's `TOPUP_CARD_LIMITS` does not set them (the default
 * table in the API's code has neither), so the BO must treat both as "no rule" and never invent a number.
 */
export interface TopupCardLimit {
  min: number
  maxPerRound: number
  /** rolling 24 h cap per account per currency; `null` = no cap at all */
  maxPerDay: number | null
  /** the amount of an **auto** card round of that currency; `null` = no auto card round is ever created */
  autoAmount: number | null
}

/** FEAT-053 (api-contract §1) — `card.account`, present only when `tiktokAccountId` was sent */
export interface TopupOptionsAccount {
  tiktokAccountId: string
  /** `balanceCurrency` of the account, uppercase; `null` = not known yet */
  currency: string | null
  /** `null` = that currency is not in the server's table, or the currency is unknown */
  limit: TopupCardLimit | null
  /** sum of the card rounds of the last 24 h (0 when the currency is unknown) */
  usedToday: number
  /** `max(0, maxPerDay − usedToday)`; `null` = that currency has no `maxPerDay` */
  remainingToday: number | null
  /** the account's current auto top-up channel (§2) */
  autoTopupChannel: TopupChannel
  /** is there a `bound`/`pending` card whose MM/YY is not past? (no secret) */
  hasUsableCard: boolean
}

/**
 * FEAT-053 (api-contract §1) — `GET /topups/options[?tiktokAccountId=]` 200.
 * The endpoint answers **200 even without the encryption key** (`card.enabled: false`), so the BO can explain
 * why the card channel is closed instead of guessing. Everything here is a *hint*: the API's own 400/409/503
 * text stays the authority, and a non-200 means the BO silently falls back to `TOPUP_CARD_LIMITS` in
 * `app/utils/topup.ts` (spec assumption 9).
 */
export interface TopupOptionsResponse {
  qr: {
    minAmount: number
    /**
     * TASK-topup-qr-usd (2026-10-26) — with `?tiktokAccountId=`: may the QR channel be used for that account's
     * currency (USD → `false`); without an account, or on an API that predates the key, `true`/missing.
     */
    enabled?: boolean
    /** the currencies the QR channel refuses (uppercase, `['USD']`) — missing on an older API */
    unsupportedCurrencies?: string[]
  }
  card: {
    enabled: boolean
    approvalTtlHours: number
    /** key = uppercase currency */
    limits: Record<string, TopupCardLimit>
    account: TopupOptionsAccount | null
  }
  /**
   * FEAT-077 (api-contract v1 §6.5) — would a manual QR round of this account go to its prefix's Telegram group?
   * Missing on an API that predates the feature ⇒ read like `available: false`.
   */
  telegram?: TopupOptionsTelegram
}

/** FEAT-077 — `reason` is the API's routing skip reason (`card` · `disabled` · `notConfigured` · `noPrefix` · `notLinked` · `chatFailed` · `switchedOff` · `noAccount`) */
export interface TopupOptionsTelegram {
  available: boolean
  chatTitle: string | null
  reason: string | null
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
