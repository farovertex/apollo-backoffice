/**
 * FEAT-005 — human texts for `tiktokAccounts.lastDiscoverError` (api-contract.md v1 §7 "error texts").
 * `DISCOVER_ERROR_TEXT` = full sentence (sync toast, chip tooltip); `DISCOVER_ERROR_SHORT` = the row chip
 * (`ta-adv-error`) in the Advertisers column.
 */
import type { DiscoverError } from '#shared/types/tiktok-accounts'

export const DISCOVER_ERROR_TEXT: Record<DiscoverError, string> = {
  notLoggedIn: 'Not logged in — press Login first',
  noOrgId: 'No Business Center org found',
  listApiFailed: 'TikTok account list could not be read',
  timeout: 'Timed out',
  unknown: 'Unknown page — see events'
}

export const DISCOVER_ERROR_SHORT: Record<DiscoverError, string> = {
  notLoggedIn: 'Not logged in',
  noOrgId: 'No org',
  listApiFailed: 'List failed',
  timeout: 'Timeout',
  unknown: 'Unknown'
}

/** Full text for toasts / tooltips; unknown codes fall back to the code itself, null to a generic sentence. */
export function discoverErrorText(code: DiscoverError | string | null | undefined): string {
  if (!code) return 'Advertiser sync did not complete'
  return (DISCOVER_ERROR_TEXT as Record<string, string>)[code] ?? code
}

/** Short text for the row chip; unknown codes fall back to the code itself. */
export function discoverErrorShort(code: DiscoverError | string): string {
  return (DISCOVER_ERROR_SHORT as Record<string, string>)[code] ?? code
}
