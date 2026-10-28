/**
 * FEAT-051 / FEAT-078 — the credit/debit cards of a **TikTok account**, on both sides:
 *  - `cards[]` (`PaymentCardView`) — the cards **we** store for the card top-up channel (FEAT-051 api-contract §7).
 *    There is no "add card" and no "edit card" endpoint (D11): a card is born when a round of the card channel is
 *    created with `card: { … }`. The full number, the CVV and their ciphertext never leave the API.
 *  - `tiktok.cards[]` (`TikTokCardView`, FEAT-078 api-contract §2.1) — the cards **TikTok** has on file for the
 *    account's Business Center, as the last `cardManage` job read them from the BC payment page (never a token).
 *  - `job` (`CardManageJobView`) — the account's latest `topup/cardManage` job (`sync | setPrimary | remove`).
 *
 * Roles (FEAT-078 api-contract §2.0 — **replaces** the FEAT-051 GOD/Payment rule and the FEAT-075 widening):
 * every route of `/tiktok-accounts/:id/payment-cards` is **GOD or Admin**, scoped to the account's workspace
 * (`canAccessWorkspace`: an Admin of another workspace gets 404 `ไม่พบ account`). A **Payment-only** admin gets
 * **403** everywhere — the accounts page does not offer `ta-cards-open` to them, and FEAT-075's Edit modal treats
 * that 403 as "no cards". `GET`, `DELETE …/:cardId` and `POST …/:cardId/default` still answer **503** while the
 * server has no `CARD_ENCRYPTION_KEY`; the three job routes (`sync`, `tiktok/:id/primary`, `tiktok/:id/remove`) do
 * not need the key. The DB-only `DELETE` / `default` refuse (409) a card TikTok knows (`tiktokCardId` set or
 * `status === 'bound'`) — those go through the job.
 *
 * The FEAT-078 read-side keys (`tiktok`, `job`, `tiktokCardId`) are optional in the types on purpose: an API or a
 * QA stub that predates the feature still renders (the modal defaults them), as FEAT-051 did for its own keys.
 */

/** `pending` = never paid with · `bound` = TikTok accepted it at least once · `expired` / `removed` = unusable */
export type PaymentCardStatus = 'pending' | 'bound' | 'expired' | 'removed'

/** one row of `GET /tiktok-accounts/:id/payment-cards` (api-contract §7) */
export interface PaymentCardView {
  cardId: string
  /** `visa` | `mastercard` | `amex` | `unknown` */
  brand: string
  last4: string
  expiryMonth: number
  /** 4 digits */
  expiryYear: number
  /** `MM/YY` — the same string the pay modal and the confirm dialog show */
  expiry: string
  holderName: string
  isDefault: boolean
  /** `null` = nobody knows yet whether TikTok asks for the CVV of this card (proposal §6) */
  requireCvv: boolean | null
  status: PaymentCardStatus
  createdAt: string
  boundAt: string | null
  lastUsedAt: string | null
  /** the last human-readable reason this card could not be used (never a secret) */
  lastError: string | null
  /** FEAT-078 (17th key) — `tiktokCards.$.id` this card is linked to (last4 + MM/YY match) · null = not linked */
  tiktokCardId?: string | null
}

/** FEAT-078 — one card TikTok has on file (14 keys of api-contract §2.1, in that order) · no secret ever */
export interface TikTokCardView {
  /** TikTok's 19-digit card id */
  id: string
  last4: string
  /** `identityType` as TikTok sends it ("Master Card") */
  brand: string | null
  /** `cardOrganization` ("MAS") */
  brandCode: string | null
  /** `MM/YY` */
  expiry: string | null
  expired: boolean
  primary: boolean
  valid: boolean
  /** `statusName` ("EFFECTIVE") */
  status: string | null
  allowRemove: boolean
  allowUpdate: boolean
  /** `channelTypeName` ("CARD") */
  channelType: string | null
  createdAt: string | null
  /** `cardId` of our card whose `tiktokCardId === id` · null = TikTok-only card */
  ourCardId: string | null
}

export type CardManageAction = 'sync' | 'setPrimary' | 'remove'
export type CardManageJobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled'

export interface CardManageResult {
  cards: number
  primaryLast4: string | null
  affectedLast4: string | null
  ourCardId: string | null
}

/** FEAT-078 — the account's latest `topup/cardManage` job (12 keys of api-contract §2.1) */
export interface CardManageJobView {
  id: string
  status: CardManageJobStatus
  step: string | null
  /** the fail code (`primaryFailed`, `pinRequired`, …) */
  error: string | null
  action: CardManageAction
  tiktokCardId: string | null
  last4: string | null
  dryRun: boolean
  /** null until completed */
  result: CardManageResult | null
  /** the latest `error` log line when failed, else the last line (Thai, no secret) */
  lastLog: string | null
  createdAt: string
  finishedAt: string | null
}

/** FEAT-078 — the TikTok side of `GET …/payment-cards` */
export interface TikTokCardsBlock {
  /** last successful `card/list` capture · null = never synced */
  syncedAt: string | null
  /** last `cardManage` failure text · null after a success */
  error: string | null
  cards: TikTokCardView[]
}

/**
 * `GET /tiktok-accounts/:id/payment-cards` 200 and `POST …/:cardId/default` 200 (`{ cards, tiktok, job }` since
 * FEAT-078). `tiktok` / `job` are optional for a response that predates the feature — read them through
 * `{ syncedAt: null, error: null, cards: [] }` / `null` when missing.
 */
export interface PaymentCardsResponse {
  cards: PaymentCardView[]
  tiktok?: TikTokCardsBlock
  job?: CardManageJobView | null
}

/** `POST …/payment-cards/sync` · `…/tiktok/:tiktokCardId/primary` · `…/remove` — 202 (new job) / 200 (`reused`) */
export interface CardManageRequestResponse {
  jobId: string
  reused: boolean
  action: CardManageAction
  tiktokCardId: string | null
  last4: string | null
}

/** body of the two card routes (the BO always sends `{ dryRun: false }`) */
export interface CardManageRequestBody {
  dryRun?: boolean
}

/** 409 of the three job routes: `jobId` is present for "มี job จัดการบัตรค้างอยู่" (follow it), absent for the gates */
export interface CardManageConflictBody {
  error: string
  jobId?: string
}

/** `DELETE /tiktok-accounts/:id/payment-cards/:cardId` 200 */
export interface PaymentCardDeleteResponse {
  ok: boolean
}
