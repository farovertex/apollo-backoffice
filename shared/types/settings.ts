/**
 * FEAT-030 — system settings (api-contract.md v1 §4 `AutoTopupSettingsView`, §5 `GET`/`PATCH /settings/auto-topup`).
 *
 * One rule for the whole system instead of the per-advertiser configuration of FEAT-029: a GOD admin sets
 * `enabled`, a per-currency `minBalance`/`amount` rule and `cooldownMs` on `/settings/auto-topup`; the kpi job
 * reads the singleton document (`system_settings`, `key: 'global'`) fresh on every balance read. While no
 * document exists the API answers the defaults with `updatedAt: null`.
 *
 * `cooldownMs` is **milliseconds** on the wire; the settings page shows and edits whole minutes (spec AS-4).
 *
 * TASK-autotopup-currency (2026-10-16, contract v2) — `minBalance`/`amount` move from the top level into
 * `rules`, one entry per supported currency (the keys of `TOPUP_CARD_LIMITS`, table order; `USD`/`THB` with the
 * defaults). `minAmounts` is the read-only per-currency floor of `amount` the page shows next to each field.
 */

/** one currency's auto top-up rule — both set or both `null` (never a mix) */
export interface AutoTopupRule {
  /** integer ≥ 0 — a balance strictly below this opens a round; `null` = not configured yet */
  minBalance: number | null
  /** integer ≥ `minAmounts[currency]` (no upper bound); `null` = not configured yet */
  amount: number | null
}

/** `GET`/`PATCH /settings/auto-topup` 200 body — exactly these 6 keys. */
export interface AutoTopupSettings {
  enabled: boolean
  /** integer ≥ 0 — pause between two auto rounds of the same advertiser; `0` = no cooldown */
  cooldownMs: number
  /** every supported currency is present, table order of `TOPUP_CARD_LIMITS`; unset = both fields `null` */
  rules: Record<string, AutoTopupRule>
  /** read-only hint for the page: per-currency floor of `amount` */
  minAmounts: Record<string, number>
  /** ISO | null — `null` while the settings document does not exist (defaults in use) */
  updatedAt: string | null
}

/**
 * `PATCH /settings/auto-topup` body — strict on the API side: exactly these 3 keys on every save.
 * `enabled: true` requires at least one currency in `rules` to have both `minBalance` and `amount` set.
 */
export interface AutoTopupSettingsBody {
  enabled: boolean
  cooldownMs: number
  rules: Record<string, AutoTopupRule>
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
