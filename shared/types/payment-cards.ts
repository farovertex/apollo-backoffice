/**
 * FEAT-051 — the credit/debit cards a **TikTok account** remembers (api-contract.md v1 §7).
 *
 * There is no "add card" and no "edit card" endpoint (D11): a card is born when a round of the card channel is
 * created with `card: { … }` and from then on the BO only ever sees what this view carries — brand, last 4 digits,
 * expiry, holder name and bookkeeping. The full number, the CVV and their ciphertext never leave the API
 * (api-contract "ค่าลับห้ามออกทุกเส้น", AC-24/AC-26).
 *
 * Every route here is **GOD + Payment only**; an Admin gets 403, which is why the BO hides the whole section for
 * an admin without one of those roles instead of firing a request it knows will fail.
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
