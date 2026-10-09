/**
 * FEAT-038 — `parseUtm`, the paste-to-parse helper of the ad-template UTM section (spec U4).
 *
 * Ported 1:1 from the previous-version prototype (`to-the-mars/web/lib/utm.ts`): take everything after the
 * first `?` when the text looks like a URL, cut a `#fragment`, read the three `utm_*` keys with
 * `URLSearchParams`, trim each value and omit the empty ones. Whatever it returns overwrites only those
 * fields of the form; the pasted text itself is never sent to the API.
 *
 * The system never appends `utm_*` to any URL (binding decision of 2026-10-09) — this is only a convenience
 * for an admin who has the tracking link at hand and wants the three names filled in.
 */

/** the three names an admin types / pastes (the ids come from the API after the check on save) */
export interface UtmFields {
  utm_source: string
  utm_medium: string
  utm_campaign: string
}

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const

/**
 * The `utm_*` values found in `text`, trimmed; a key that is absent or empty is **omitted** (so the caller
 * leaves the matching form field untouched). A full URL, a bare query string and a `key=value` pair all work.
 */
export function parseUtm(text: string): Partial<UtmFields> {
  const raw = text.trim()
  const query = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : raw
  const params = new URLSearchParams(query.split('#')[0])
  const out: Partial<UtmFields> = {}
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim()
    if (value) out[key] = value
  }
  return out
}
