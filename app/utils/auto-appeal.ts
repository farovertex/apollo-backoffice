/**
 * Auto-appeal (Ads monitor selection bar) — the fixed form content sent for every ticked ad through the existing
 * `POST /ads-monitor/appeal` (FEAT-082, one job per ad). Reason 1 = "ฉันไม่คิดว่ามีการละเมิด" (`APPEAL_REASONS`).
 * The API trims the description and caps it at 2000 characters.
 */
import type { AppealReason } from '#shared/types/ads-monitor'

export const AUTO_APPEAL_REASON: AppealReason = 1

export const AUTO_APPEAL_DESCRIPTION = `Dear TikTok Ads Review Team,

We respectfully request a manual review of this advertisement because we believe the gameplay shown in the creative has been incorrectly classified as prohibited gambling-style spin mechanics.

The Thai text “หมุนก่อน 3 ที ปล่อยฟรี 10 รอบ” refers only to complimentary gameplay actions within an entertainment game. These actions do not require any real-money payment, deposit, wager, or stake and do not provide cash or rewards with real-world monetary value.

The yellow start button shown in the game interface is simply a standard gameplay control and is not a betting, wagering, or casino control.

The promoted service does not involve real-money gambling, cash deposits, withdrawals, or cash prizes.

We kindly request a manual review of the exact creative, destination URL, landing page, and actual game functionality before making a final determination.

We respectfully request reconsideration based on the non-monetary and entertainment-only nature of the advertised gameplay.

Thank you for your manual review.`
