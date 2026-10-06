/**
 * FEAT-028 — the texts of the Proxy radio (`BrowserProfilesProxyModeField`), shared by the Default settings
 * slideover, the Create-profile modal and the Add-TikTok-account modal. spec.md "UI behaviour" quotes them
 * literally, so they live in one place.
 */

/** muted helper under the radio (`${prefix}-proxy-help`) */
export const PROXY_MODE_HELP
  = 'Auto takes the oldest free proxy that passes the connectivity check (up to 5 tries); '
    + 'No proxy creates profiles without one.'

/** muted line replacing the picker when no free proxy is left (`${prefix}-proxy-empty`) */
export const PROXY_PICK_EMPTY = 'No free proxy — add one on the Proxies page or choose Auto / No proxy'

/** form error while "Pick a free proxy" is selected but nothing is chosen (blocks submit, no request) */
export const PROXY_PICK_REQUIRED = 'Choose a proxy'
