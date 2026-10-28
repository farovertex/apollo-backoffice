/**
 * FEAT-030 — system settings (api-contract.md v1 §4 `AutoTopupSettingsView`, §5 `GET`/`PATCH /settings/auto-topup`).
 *
 * One switch for the whole system instead of the per-advertiser configuration of FEAT-029: a GOD admin sets
 * `enabled` and `cooldownMs` on `/settings/auto-topup`; the kpi job reads the singleton document
 * (`system_settings`, `key: 'global'`) fresh on every balance read. While no document exists the API answers the
 * defaults with `updatedAt: null`.
 *
 * `cooldownMs` is **milliseconds** on the wire; the settings page shows and edits whole minutes (spec AS-4).
 *
 * TASK-autotopup-currency (2026-10-16, contract v2) — `minBalance`/`amount` moved from the top level into a
 * per-currency `rules` map. **FEAT-075 removed that map again** (api-contract v1 §1.2/§4): the amounts now live
 * on each TikTok account (`autoTopupConfig`, set from the account's Edit modal), so the system keeps only the
 * master switch and the cooldown. `rules`, `minAmounts` and the `AutoTopupRule` type are gone — the API answers
 * 400 `ไม่รู้จัก field "rules"` for a body that still carries them.
 */

/** `GET`/`PATCH /settings/auto-topup` 200 body — exactly these 3 keys (FEAT-075). */
export interface AutoTopupSettings {
  /** master switch: `false` = no account tops up automatically, whatever its own config says */
  enabled: boolean
  /** integer ≥ 0 — pause between two auto rounds of the same advertiser; `0` = no cooldown */
  cooldownMs: number
  /** ISO | null — `null` while the settings document does not exist (defaults in use) */
  updatedAt: string | null
}

/**
 * `PATCH /settings/auto-topup` body — strict on the API side: exactly these 2 keys on every save.
 * `enabled: true` needs nothing else (FEAT-075: the numbers are per account).
 */
export interface AutoTopupSettingsBody {
  enabled: boolean
  cooldownMs: number
}

/**
 * FEAT-038 (api-contract v1 §4) — the global list of UTM prefixes an ad template may bind to.
 * `GET /settings/utm` 200 body (GOD + Admin readable; the page itself is GOD-only, spec AS-9).
 * Defaults are `[]` / `null` while the settings document does not exist — the GET never creates it.
 */
export interface UtmSettings {
  /** exact, case-sensitive, no inner whitespace, ≤ 50 items — a prefix becomes part of the 3rd-party host */
  prefixes: string[]
  /** ISO | null — the singleton's `updatedAt`, shared with the auto-top-up block */
  updatedAt: string | null
}

/** `PATCH /settings/utm` body (GOD) — strict, always the **complete** new list. */
export interface UtmSettingsBody {
  prefixes: string[]
}

/**
 * `PATCH /settings/utm` 200 body — `UtmSettings` + the prefixes **removed by this PATCH** that some ad
 * template still binds to (sorted; `[]` when nothing removed is in use). Removing an in-use prefix is allowed:
 * the template keeps working, but its next save with `utm` has to pick a listed prefix (AS-5).
 */
export interface UtmSettingsPatchResponse extends UtmSettings {
  inUse: string[]
}
