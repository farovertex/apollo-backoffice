/**
 * FEAT-023 — presentation of the automatic first login (`tiktokAccounts.pendingFirstLogin` / `firstLoginFail` /
 * `firstLoginTries`) for the "First login" column of `/tiktok-accounts`.
 *
 * The UI name of the flag is **Auto first login** (human decision 2026-10-01); `pendingFirstLogin` is never printed
 * as a label. The failure codes *are* printed as-is (spec.md "UI behaviour": the cell reads `email_fail 2/3`) with
 * `FIRST_LOGIN_FAIL_TEXT` as the tooltip so a human knows what the code means.
 */
import type { FirstLoginFail, FirstLoginTries } from '#shared/types/tiktok-accounts'

/** Helper under the "Auto first login" checkbox, in the Add modal and in the batch modal (spec.md "UI behaviour"). */
export const AUTO_FIRST_LOGIN_HELP
  = 'After the account is created, the worker signs in once (mailbox then TikTok), then this turns off.'

/** Which `firstLoginTries` counter belongs to a failure code. */
const FAIL_TRY_KEY: Record<FirstLoginFail, keyof FirstLoginTries> = {
  email_fail: 'email',
  captcha_fail: 'captcha',
  otp_fail: 'otp',
  other_fail: 'other'
}

/**
 * Attempt ceiling per kind — api-contract.md v1 §1 defaults (`FIRST_LOGIN_EMAIL_FAIL_MAX` 3,
 * `FIRST_LOGIN_OTP_FAIL_MAX` 1, `FIRST_LOGIN_OTHER_FAIL_MAX` 1) and FEAT-004's `loginFailures ≥ 2` for the captcha
 * retries. Only the denominator of the cell; the API owns the real decision.
 */
export const FIRST_LOGIN_TRY_MAX: Record<keyof FirstLoginTries, number> = {
  email: 3,
  captcha: 2,
  otp: 1,
  other: 1
}

export const FIRST_LOGIN_FAIL_TEXT: Record<FirstLoginFail, string> = {
  email_fail: 'Could not sign in to the mailbox — check the email password or the mail domain',
  captcha_fail: 'Captcha could not be solved',
  otp_fail: 'The verification code did not arrive in time',
  other_fail: 'The first login stopped for another reason — see the login error'
}

/** Full text for the tooltip; an unknown code falls back to the code itself. */
export function firstLoginFailText(code: FirstLoginFail | string | null | undefined): string {
  if (!code) return 'The first login did not complete'
  return (FIRST_LOGIN_FAIL_TEXT as Record<string, string>)[code] ?? code
}

/** `email_fail` + `{ email: 2, … }` → `2/3`; an unknown code has no counter. */
export function firstLoginTryCount(code: FirstLoginFail | string, tries: FirstLoginTries | null | undefined): string | null {
  const key = (FAIL_TRY_KEY as Record<string, keyof FirstLoginTries | undefined>)[code]
  if (!key) return null
  return `${tries?.[key] ?? 0}/${FIRST_LOGIN_TRY_MAX[key]}`
}
