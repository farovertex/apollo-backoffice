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
 * FEAT-076 (api-contract §4): the shape is unchanged but the list is now served from the `prefixes` collection —
 * `prefixes` = the `code` of every **active** prefix row (createdAt asc), `updatedAt` = the newest `updatedAt` of
 * any prefix row (`null` when there is none). `PATCH /settings/utm` is **gone** (410 for a GOD): the list is managed
 * on `/settings/prefixes` (`POST`/`PATCH /prefixes`, `shared/types/prefixes.ts`), so the former
 * `UtmSettingsBody` / `UtmSettingsPatchResponse` types are removed.
 */
export interface UtmSettings {
  /** exact, case-sensitive, no inner whitespace — a prefix becomes part of the 3rd-party host */
  prefixes: string[]
  /** ISO | null — newest `updatedAt` over all prefix rows */
  updatedAt: string | null
}

/**
 * FEAT-077 (api-contract v1 §3, §10) — `GET`/`PATCH /settings/telegram` 200 body (GOD only).
 * The whole Telegram QR-group feature is gated by `enabled` **and** a server-side bot token (`configured`); the
 * groups themselves are linked per prefix on `/settings/prefixes`.
 */
export interface TelegramSettings {
  /** the GOD switch — `false` while no settings document / sub-document exists */
  enabled: boolean
  /** `TELEGRAM_BOT_TOKEN` is set on the server (never the token itself) */
  configured: boolean
  /** cached `getMe().username`; `null` when not configured or Telegram could not be reached */
  botUsername: string | null
  /** ISO | null — `null` while the settings document does not exist */
  updatedAt: string | null
}

/** `PATCH /settings/telegram` body — strict on the API side: exactly this key */
export interface TelegramSettingsBody {
  enabled: boolean
}
