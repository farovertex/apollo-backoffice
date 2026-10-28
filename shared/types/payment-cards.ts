/**
 * FEAT-051 — the credit/debit cards a **TikTok account** remembers (api-contract.md v1 §7).
 *
 * There is no "add card" and no "edit card" endpoint (D11): a card is born when a round of the card channel is
 * created with `card: { … }` and from then on the BO only ever sees what this view carries — brand, last 4 digits,
 * expiry, holder name and bookkeeping. The full number, the CVV and their ciphertext never leave the API
 * (api-contract "ค่าลับห้ามออกทุกเส้น", AC-24/AC-26).
 *
 * Roles (FEAT-051 AS-4, widened by **FEAT-075 api-contract v1.1 §8**):
 *  - `GET /tiktok-accounts/:id/payment-cards` — **GOD, Payment and the account's Admin** (read-only metadata).
 *    It was GOD/Payment only until FEAT-075; an Admin who may now set `autoTopupConfig.channel: 'card'` has to be
 *    able to list the cards to choose from. The scope is unchanged (`accountOf`: an Admin only reaches accounts of
 *    a workspace they can access, else 404), and the response never grew a secret.
 *  - `POST …/:cardId/default` and `DELETE …/:cardId` — **still GOD + Payment only** (they mutate a payment
 *    instrument); an Admin gets 403, which is why the BO keeps hiding the cards **modal** (`ta-cards-open`) for an
 *    admin without one of those roles instead of firing a request it knows will fail.
 *  - every route answers **503** while the server has no `CARD_ENCRYPTION_KEY`: the card channel is closed for
 *    everybody. The Edit modal's auto top-up section shows that `error` text in `ta-edit-auto-card-none`.
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
}

/** `GET /tiktok-accounts/:id/payment-cards` 200 and `POST …/:cardId/default` 200 */
export interface PaymentCardsResponse {
  cards: PaymentCardView[]
}

/** `DELETE /tiktok-accounts/:id/payment-cards/:cardId` 200 */
export interface PaymentCardDeleteResponse {
  ok: boolean
}
