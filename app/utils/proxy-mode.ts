/**
 * FEAT-028 — the texts of the Proxy radio (`BrowserProfilesProxyModeField`), shared by the Default settings
 * slideover, the Create-profile modal and the Add-TikTok-account modal. spec.md "UI behaviour" quotes them
 * literally, so they live in one place.
 * TASK-profile-proxy — the "Change proxy" modal of an existing profile reuses the same radio and texts, and
 * `formatProxySnapshot()` is the one proxy-snapshot formatter of the Browser profiles page and that modal.
 */
import type { AvailableProfileProxy } from '#shared/types/browser-profiles'

/** muted helper under the radio (`${prefix}-proxy-help`) */
export const PROXY_MODE_HELP
  = 'Auto takes the oldest free proxy that passes the connectivity check (up to 5 tries); '
    + 'No proxy creates profiles without one.'

/** muted line replacing the picker when no free proxy is left (`${prefix}-proxy-empty`) */
export const PROXY_PICK_EMPTY = 'No free proxy — add one on the Proxies page or choose Auto / No proxy'

/** form error while "Pick a free proxy" is selected but nothing is chosen (blocks submit, no request) */
export const PROXY_PICK_REQUIRED = 'Choose a proxy'

/**
 * The provider proxy **snapshot** of a profile as one line — `<type> <host>:<port> · <country>`, the parts that are
 * set. `null` = the profile has no proxy (the Browser profiles table renders that as `—`, the TASK-profile-proxy
 * Change-proxy modal as "No proxy"), so both surfaces format the same snapshot the same way.
 */
export function formatProxySnapshot(proxy: AvailableProfileProxy | null): string | null {
  if (!proxy) return null
  const endpoint = proxy.port ? `${proxy.host}:${proxy.port}` : proxy.host
  const main = [proxy.type, endpoint].filter(Boolean).join(' ')
  return proxy.country ? `${main} · ${proxy.country}` : main
}
