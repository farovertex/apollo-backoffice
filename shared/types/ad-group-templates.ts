/**
 * FEAT-061 — `/ad-group-templates` **v3** ("Smart+" shape, apollo-api, function 6.8). Mirrors
 * mission-control/.ai/features/FEAT-061-smart-campaign-template-campaign-section-in-ad-gro/api-contract.md v1
 * (§1 shapes, §2 endpoints, §5 BO integration), which supersedes the FEAT-011 contract v2:
 * - `config` goes from 19 to **15 keys**: the new `campaign` section (name / budget strategy / campaign budget /
 *   bid strategy) and `targetCpa` replace `dataConnection`, `optimizationEvent`, `optimizationGoal`,
 *   `savedAudience`, `spendingPower` and `costCap` (`costCap` → `targetCpa`).
 * - `catalogVersion` moves to `advertisingGroup/v4` (the Smart+ unified wizard shape) and every template view
 *   carries the derived `kind`: `smartPlus` for v4, **`manual`** for anything else (incl. `null`). A manual row
 *   cannot be PATCHed or used for an order any more — it goes through the migration lane
 *   (`GET /:id/migration` + `POST /:id/migrate`).
 *
 * The BO hard-codes **no** enum label: every human-readable string for a config value comes from
 * `GET /ad-group-templates/options` (`OptionItem { value, label }`), which is fetched once per page
 * lifetime and reused by the modals.
 *
 * **TASK-adgroup-targeting** (human request 2026-10-25, contract v3 → **v3.1**): `config` goes from 15 to
 * **17 keys** — `targetingMode` and `spendingPower` are inserted right after `gender` and decide which mode the
 * worker puts TikTok's "การกำหนดเป้าหมายผู้ชม" section in. `campaign.name` stays in the shape (nullable, so old
 * templates keep validating) but the worker never types it: the campaign always gets TikTok's default name, so the
 * BO has no name input any more and always sends `null`.
 * Both new keys and their three `/options` entries (`targetingMode`, `spendingPower`, `targetingModeHint`) are
 * **optional in these types** so a BO built against this contract still renders — and still saves — against an
 * API that predates it (then the two controls are hidden and the keys are left out of the body).
 */

/** One entry of an option list served by `GET /ad-group-templates/options`. */
export interface OptionItem {
  value: string
  label: string
}

export type Placement = 'website' | 'instantPage'
export type AgeGroup = '13-17' | '18-24' | '25-34' | '35-44' | '45-54' | '55+'
export type Gender = 'all' | 'male' | 'female'
export type BudgetType = 'daily' | 'lifetime'
export type Currency = 'THB'
export type ScheduleMode = 'continuous' | 'dateRange'
export type StartTimeMode = 'now' | 'scheduled'
export type Timezone = 'Asia/Bangkok'
export type Dayparting = 'allDay'
/** FEAT-061 — `config.campaign.budgetStrategy`: CBO (campaign budget) or one budget per ad group */
export type BudgetStrategy = 'cbo' | 'adGroup'
/** FEAT-061 — `config.campaign.bidStrategy`; `costCap` is the only one that uses `config.targetCpa` */
export type BidStrategy = 'maxResults' | 'costCap'
/** TASK-adgroup-targeting — `config.targetingMode`: which mode the worker puts TikTok's audience section in */
export type TargetingMode = 'auto' | 'manual'
/** TASK-adgroup-targeting — `config.spendingPower`: TikTok's "กำลังซื้อ" chip, **manual mode only** */
export type SpendingPower = 'all' | 'high'

/**
 * TASK-adgroup-targeting — `options.targetingModeHint`: what each mode does to the other audience values, served
 * by the API per mode (the BO hard-codes none of it, it only picks the entry of the selected mode).
 */
export interface TargetingModeHint {
  auto: string
  manual: string
}

/**
 * FEAT-061 — `config.campaign`: the campaign-page choices of the Smart+ wizard, stored inside the ad-group
 * template (there is no campaign template collection). `budget` is required (non-null) for `cbo` and must be
 * `null` for `adGroup`; `name` is trimmed and `''` is sent as `null` (= let TikTok name the campaign).
 */
export interface AdGroupCampaign {
  /**
   * TASK-adgroup-targeting — **ignored by the worker**: the campaign always keeps TikTok's own default name, so
   * the BO has no input for it and always sends `null`. The key stays in the shape because stored templates
   * (and therefore order snapshots) still carry the name they were saved with.
   */
  name: string | null
  budgetStrategy: BudgetStrategy
  budget: AdGroupBudget | null
  bidStrategy: BidStrategy
}

/**
 * `config.schedule` — `startTime` is the literal `'now'` or an absolute ISO-8601 (UTC) string;
 * `endTime` exists only for `dateRange` (assumption A9).
 */
export type AdGroupSchedule
  = | { mode: 'continuous', startTime: 'now' | string }
    | { mode: 'dateRange', startTime: 'now' | string, endTime: string }

export interface AdGroupBudget {
  type: BudgetType
  amount: number
  currency: Currency
}

/** `config.audiences` — both keys required; plain TikTok audience names (no ids, no enum). */
export interface AdGroupAudiences {
  include: string[]
  exclude: string[]
}

/** A tri-state advanced-placement toggle: `null` = leave TikTok's own default (FEAT-011 A3). */
export type TriState = boolean | null

/** `config.advancedPlacement` — all five keys required, each tri-state. */
export interface AdGroupAdvancedPlacement {
  organicComments: TriState
  comments: TriState
  videoDownload: TriState
  videoSharing: TriState
  useBlockList: TriState
}

/** The keys of `config.advancedPlacement`, in `options.advancedPlacementKey` order. */
export type AdvancedPlacementKey = keyof AdGroupAdvancedPlacement

/**
 * The 17 config keys of an ad group template **v3.1** (strict on the API side, in `CONFIG_KEYS` order —
 * FEAT-061 api-contract §1.1 + TASK-adgroup-targeting). A **manual** row (`kind: 'manual'`) still carries its old 13/19 keys as stored,
 * so a reader of an arbitrary row treats this type as the v3 shape only (see `AdGroupConfigSnapshot` of
 * `campaign-orders.ts` for the permissive reader).
 */
export interface AdGroupConfig {
  /** null = let TikTok auto-name the ad group (the worker skips the prefix since 2026-10-08) */
  adGroupNamePrefix: string | null
  /** FEAT-061 — the campaign page of the Smart+ wizard, stored with the ad group */
  campaign: AdGroupCampaign
  /**
   * FEAT-061 — target cost per result, filled on the aio ad-group page. Required (non-null) when
   * `campaign.bidStrategy === 'costCap'` and must be `null` for `maxResults`. Replaces v2's `costCap`.
   */
  targetCpa: number | null
  /** `instantPage` is the only placement the Smart+ worker supports (`website` → preflight refuses the build) */
  placement: Placement
  /** ISO-3166 alpha-2, at least one, no duplicates */
  locations: string[]
  /** empty array = unlimited (`options.ageGroupsUnlimitedLabel`) */
  ageGroups: AgeGroup[]
  gender: Gender
  /**
   * TASK-adgroup-targeting — `auto` (TikTok's "การกำหนดเป้าหมายอัตโนมัติ": age / gender / interests are only a
   * *recommendation*, languages still restrict) or `manual` (every value restricts the audience and the rebate
   * offer is lost). Optional in this type only so a response of an API that predates v3.1 still type-checks;
   * such a row reads as `auto` in the form.
   */
  targetingMode?: TargetingMode
  /**
   * TASK-adgroup-targeting — TikTok's "กำลังซื้อ" chip of the detailed-targeting panel. **Manual only**: with
   * `targetingMode: 'auto'` it must stay `'all'` (the API answers 400 with an issue at `config.spendingPower`).
   */
  spendingPower?: SpendingPower
  /** the **ad group** budget (`options.minBudget`); the campaign budget is `campaign.budget` */
  budget: AdGroupBudget
  schedule: AdGroupSchedule
  timezone: Timezone
  dayparting: Dayparting
  /** audience names to include / exclude (≤ `listLimits.maxItems` each) — pass-through, no control edits it */
  audiences: AdGroupAudiences
  /** interest & behaviour names (≤ `listLimits.maxItems`) */
  interests: string[]
  /** language names; `[]` = unlimited (`options.unlimitedLabel`) */
  languages: string[]
  /** five tri-state toggles */
  advancedPlacement: AdGroupAdvancedPlacement
}

/**
 * FEAT-061 (api-contract §1.2) — derived from `catalogVersion`, never stored: `smartPlus` when the row was
 * authored against the version `/options` serves (`advertisingGroup/v4`), `manual` for every older version and
 * for `null`. A `manual` row can only be read, duplicated, deleted or **migrated**.
 */
export type AdGroupTemplateKind = 'manual' | 'smartPlus'

/** Exact key set of the API's template view v3 — 11 keys (`kind` after `catalogVersion`). */
export interface AdGroupTemplate {
  id: string
  name: string
  description: string | null
  config: AdGroupConfig
  /**
   * The catalog version the template was authored against (`advertisingGroup/v4` since FEAT-061), written by
   * the API. `null` for documents written before FEAT-011 → `kind: 'manual'`.
   */
  catalogVersion: string | null
  /**
   * FEAT-061 — `smartPlus` / `manual`, computed per request from `catalogVersion`. Optional in this type only
   * so a BO page can still read a response of an API that predates the feature (then fall back to comparing
   * `catalogVersion` with `options.catalogVersion`).
   */
  kind?: AdGroupTemplateKind
  /** `name` is null when the workspace row is gone */
  workspace: { id: string, name: string | null }
  /** `username` is null when the admin row is gone */
  createdBy: { id: string, username: string | null }
  /**
   * FEAT-057 (api-contract v1 §1.1) — may the **caller of this request** edit / delete this template
   * (`isGod(ctx) || createdBy === ctx.adminId`)? Computed per request, never stored. The page renders Edit and
   * Delete only for a row that carries `true`; every row can be duplicated.
   */
  canEdit: boolean
  createdAt: string
  updatedAt: string
}

/** `GET /ad-group-templates` 200 body — paginated envelope. */
export interface AdGroupTemplatesResponse {
  templates: AdGroupTemplate[]
  page: number
  limit: number
  total: number
}

/**
 * FEAT-058 — one row of `GET /ad-group-templates/creators` (api-contract.md v1 §1, §3), the option list of
 * the BO's **Created by** select. `me` is `workspaceId === ctx.homeWorkspaceId`; exactly one row carries it.
 */
export interface Creator {
  workspaceId: string
  workspaceName: string | null
  adminId: string | null
  username: string | null
  me: boolean
}

/** `GET /ad-group-templates/creators` 200 body — exactly one top-level key. */
export interface CreatorsResponse {
  creators: Creator[]
}

/** `options.listLimits` — the API's own numbers for every free-text list (FEAT-011 A5). */
export interface AdGroupListLimits {
  maxItems: number
  maxLength: number
}

/**
 * `GET /ad-group-templates/options` 200 body — the **16** label lists plus the BO helpers
 * (`ageGroupsUnlimitedLabel`, `unlimitedLabel`, `minBudget`, `campaignMinBudget`, `systemDefault`,
 * `catalogVersion`, `listLimits`, `targetingModeHint`) — FEAT-061 api-contract §2.0 + TASK-adgroup-targeting,
 * 24 top-level keys.
 */
export interface AdGroupTemplateOptions {
  placement: OptionItem[]
  locations: OptionItem[]
  ageGroups: OptionItem[]
  gender: OptionItem[]
  budgetType: OptionItem[]
  currency: OptionItem[]
  scheduleMode: OptionItem[]
  startTimeMode: OptionItem[]
  timezone: OptionItem[]
  dayparting: OptionItem[]
  /** `inherit` ↔ `null`, `on` ↔ `true`, `off` ↔ `false` */
  advancedPlacementState: OptionItem[]
  /** the five `config.advancedPlacement` keys, in the order the advanced section renders them */
  advancedPlacementKey: OptionItem[]
  /** FEAT-061 — `cbo` / `adGroup` labels of `config.campaign.budgetStrategy` */
  budgetStrategy: OptionItem[]
  /** FEAT-061 — `maxResults` / `costCap` labels of `config.campaign.bidStrategy` */
  bidStrategy: OptionItem[]
  /**
   * TASK-adgroup-targeting — `auto` / `manual` labels of `config.targetingMode`. **Optional**: an API that
   * predates v3.1 serves no list, and then the BO hides the mode radio *and* the spending-power control and
   * leaves both keys out of the body (so the form keeps working against the old contract).
   */
  targetingMode?: OptionItem[]
  /** TASK-adgroup-targeting — `all` / `high` labels of `config.spendingPower` (optional, same reason) */
  spendingPower?: OptionItem[]
  /** TASK-adgroup-targeting — the sentence shown under the mode radio, per mode (optional, same reason) */
  targetingModeHint?: TargetingModeHint
  /** shown when no age group is selected */
  ageGroupsUnlimitedLabel: string
  /** shown when a free-text list (Languages) is empty */
  unlimitedLabel: string
  /** minimum ad-group `budget.amount` per currency (env `AD_GROUP_MIN_BUDGET`) */
  minBudget: Record<string, number>
  /**
   * FEAT-061 — minimum `campaign.budget.amount` per currency (env `CAMPAIGN_MIN_BUDGET`, default
   * `{ THB: 200 }`). Optional in this type only so the form still renders against an API that predates the
   * feature (then no minimum is enforced client-side and the API's 400 is shown).
   */
  campaignMinBudget?: Record<string, number>
  /** TikTok's values on a fresh page — the create form's starting point, never stored */
  systemDefault: AdGroupConfig
  /** the catalog version the API writes on every save (`advertisingGroup/v4` since FEAT-061) */
  catalogVersion: string
  /** the limits the BO validates the tag inputs with */
  listLimits: AdGroupListLimits
}

/** `POST /ad-group-templates` body — `config` is complete (all 17 keys of v3.1), never `catalogVersion`. */
export interface CreateAdGroupTemplateBody {
  name: string
  description?: string | null
  config: AdGroupConfig
  /**
   * FEAT-057 (api-contract v1 §5) — the id of the template this one was duplicated from. Only sent by the
   * Duplicate flow; the API uses it for the audit detail `duplicatedFrom` (unknown id → 404 `ไม่พบ template`).
   * The new row stores nothing of it: name / description / config are what this body carries.
   */
  duplicateOf?: string
}

/**
 * `PATCH /ad-group-templates/:id` body — **only the changed keys**. `config` is a partial at the
 * top level: each present key carries its complete value and replaces the stored one wholesale (A3).
 * `catalogVersion` is never sent (the API rewrites it itself on every successful PATCH).
 */
export interface PatchAdGroupTemplateBody {
  name?: string
  description?: string | null
  config?: Partial<AdGroupConfig>
}

/** `DELETE /ad-group-templates/:id` 200 body. */
export interface DeleteAdGroupTemplateResponse {
  ok: boolean
}

/**
 * FEAT-061 (api-contract §2.1) — the v3 draft the API computed from a **manual** template: the v3 shape where
 * `campaign.budgetStrategy` can be `null` (nothing to map it from) and `campaign.budget` always starts `null`.
 * Everything else is carried as stored, with the system default (and a `notes[]` line) for a key the old
 * document did not have.
 */
export interface MigrationDraft extends Omit<AdGroupConfig, 'campaign'> {
  campaign: {
    name: string | null
    budgetStrategy: BudgetStrategy | null
    budget: AdGroupBudget | null
    bidStrategy: BidStrategy
  }
}

/** FEAT-061 — one entry of `dropped[]`: a v2 key that v3 has no place for, with its **stored** value. */
export interface MigrationDroppedKey {
  key: string
  value: unknown
}

/**
 * `GET /ad-group-templates/:id/migration` 200 body (api-contract §2.1) — read-only, writes nothing.
 * A Smart+ row answers 409 `{ error, reason: 'alreadySmartPlus' }`, an unknown id 404.
 */
export interface MigrationResponse {
  kind: 'manual'
  /** the row's old `catalogVersion` (`null` for a pre-FEAT-011 document) */
  from: string | null
  draft: MigrationDraft
  /** v3 paths the draft leaves empty and the admin has to fill (e.g. `campaign.budgetStrategy`) */
  required: string[]
  /** the v2 keys that will be lost, with their stored values */
  dropped: MigrationDroppedKey[]
  /** `costCap → targetCpa` when a non-null `costCap` existed */
  renamed: { from: string, to: string }[]
  /** human-readable notes of what the mapper changed (placement, past start time, defaulted keys) */
  notes: string[]
}

/**
 * `POST /ad-group-templates/:id/migrate` body (api-contract §2.2) — the **complete** 17-key v3.1 config,
 * strict: no `name`, no `description`, no `catalogVersion`. 200 answers the template view with
 * `kind: 'smartPlus'`.
 */
export interface MigrateBody {
  config: AdGroupConfig
}
