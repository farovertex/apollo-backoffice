/**
 * FEAT-016 — fixed English page chrome for the readiness reasons of `GET /launch/targets` and for the
 * 409 `rejected[].reasons` of `POST /campaign-orders` (api-contract.md v1 §4, column "BO text").
 * These are not enum labels of a template field (those always come from the templates' `/options`):
 * the API serves the reason codes only, the wording is the BO's.
 */
import type { RejectedReason, UnavailableReason } from '#shared/types/campaign-orders'

export const UNAVAILABLE_REASON_TEXT: Record<UnavailableReason, string> = {
  inactive: 'Account is disabled',
  notLoggedIn: 'Not logged in — press Login on TikTok accounts',
  needsHuman: 'Waiting for an OTP',
  jobRunning: 'Login or sync is running',
  buildInProgress: 'A build of another order is queued or running',
  noActiveAdvertiser: 'No active advertiser'
}

/** Only the create call can answer this one (the advertiser stopped being selectable between the two calls). */
export const REJECTED_REASON_TEXT: Record<RejectedReason, string> = {
  ...UNAVAILABLE_REASON_TEXT,
  advertiserNotSelectable: 'The chosen advertiser is not active any more'
}

/** Text of one reason code; an unknown code falls back to the code itself so nothing renders empty. */
export function reasonText(code: RejectedReason | string): string {
  return (REJECTED_REASON_TEXT as Record<string, string>)[code] ?? code
}

/** `a · b · c` — every reason of one account, in the order the API listed them. */
export function reasonsText(codes: readonly (RejectedReason | string)[]): string {
  return codes.length === 0 ? '—' : codes.map(reasonText).join(' · ')
}
