/**
 * FEAT-036 — presentation of `tiktokAccounts.recoveryEmail` (spec.md "UI behaviour (BO)", api-contract.md v1 §7):
 * the temp-mail address Microsoft's `account.live.com/identity/confirm` page sends its security code to when the
 * mailbox driver signs in to an account that is stopped by that page. A secret like `loginEmail` /
 * `emailPassword` — the table masks it by default; the full value is only put in the DOM once the row toggle is
 * on (same rule as `PasswordCell`).
 */

/** Helper under the Add modal's "Recovery email" field (`ta-add-recovery-email-helper`). */
export const RECOVERY_EMAIL_HELP
  = 'Temp-mail address Microsoft sends its security code to when it asks to confirm the identity.'

/**
 * Mask a recovery email for the accounts table (`ta-recovery-email`, §7): the first 2 characters of the local
 * part (1 when the local part has only 1 character), `***`, `@`, then the full domain — e.g.
 * `ertonrobo@fviainboxes.com` → `er***@fviainboxes.com`. The full address is never put in the DOM while masked
 * (the caller only calls this when `shown` is false). Returns the input unchanged if it has no `@` (defensive;
 * the API never stores a non-email value here).
 */
export function maskRecoveryEmail(email: string): string {
  const at = email.indexOf('@')
  if (at <= 0) return email
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  const visible = local.slice(0, Math.min(2, local.length))
  return `${visible}***@${domain}`
}
