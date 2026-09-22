/**
 * FEAT-004 — human texts for `tiktokAccounts.lastLoginError` (spec.md "UI behaviour" → error state mapping).
 * `LOGIN_ERROR_TEXT` = full sentence in the LoginModal error state; `LOGIN_ERROR_SHORT` = the row chip
 * (`ta-login-error`) next to the Session status badge.
 */
import type { LoginError } from '#shared/types/tiktok-accounts'

export const LOGIN_ERROR_TEXT: Record<LoginError, string> = {
  badCredentials: 'Wrong email or password',
  captchaFailed: 'Captcha could not be solved',
  otpExpired: 'The code expired',
  otpRejected: 'The code was rejected',
  deviceVerify: 'TikTok asks for device verification — log in manually once',
  blocked: 'The account is blocked or suspended',
  timeout: 'Timed out',
  unknown: 'Unknown page — see screenshot'
}

export const LOGIN_ERROR_SHORT: Record<LoginError, string> = {
  badCredentials: 'Wrong credentials',
  captchaFailed: 'Captcha failed',
  otpExpired: 'Code expired',
  otpRejected: 'Code rejected',
  deviceVerify: 'Device verification',
  blocked: 'Blocked',
  timeout: 'Timed out',
  unknown: 'Unknown page'
}

/** Full text for the modal; unknown codes fall back to the code itself, null to a generic sentence. */
export function loginErrorText(code: LoginError | string | null | undefined): string {
  if (!code) return 'Login did not complete'
  return (LOGIN_ERROR_TEXT as Record<string, string>)[code] ?? code
}

/** Short text for the row chip; unknown codes fall back to the code itself. */
export function loginErrorShort(code: LoginError | string): string {
  return (LOGIN_ERROR_SHORT as Record<string, string>)[code] ?? code
}
