/**
 * FEAT-011 — `/ad-group-templates` **v2** (apollo-api, function 6.8). Mirrors
 * mission-control/.ai/features/FEAT-011-ad-group-template-v2-catalog-fields/api-contract.md v2
 * ("Template view", `GET /options`, `GET/POST/PATCH/DELETE /ad-group-templates`), which supersedes the
 * FEAT-008 contract v1: `config` grows from 13 to **19 keys**, `placement` gains `instantPage` and every
 * template carries the `catalogVersion` it was authored against (set by the API, never sent by the BO).
 *
 * The BO hard-codes **no** enum label: every human-readable string for a config value comes from
 * `GET /ad-group-templates/options` (`OptionItem { value, label }`), which is fetched once per page
 * lifetime and reused by the modals.
 */

/** One entry of an option list served by `GET /ad-group-templates/options`. */
export interface OptionItem {
  value: string
  label: string
}

export type Placement = 'website' | 'instantPage'
export type OptimizationEvent = 'purchase'
export type AgeGroup = '13-17' | '18-24' | '25-34' | '35-44' | '45-54' | '55+'
export type Gender = 'all' | 'male' | 'female'
export type BudgetType = 'daily' | 'lifetime'
export type Currency = 'THB'
export type ScheduleMode = 'continuous' | 'dateRange'
export type StartTimeMode = 'now' | 'scheduled'
export type Timezone = 'Asia/Bangkok'
export type Dayparting = 'allDay'
export type OptimizationGoal = 'conversion'
export type DataConnectionMode = 'first' | 'named'
export type SavedAudienceMode = 'none' | 'named'
export type SpendingPower = 'all' | 'high'

/** `config.dataConnection` — discriminated union, strict on the API side. */
export type AdGroupDataConnection
  = | { mode: 'first' }
    | { mode: 'named', name: string }

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

/**
 * `config.savedAudience` — discriminated union, strict on the API side (`{ mode: 'none', name }` → 400).
 * `named` means the job picks that saved audience on TikTok and ignores the custom targeting keys.
 */
export type AdGroupSavedAudience
  = | { mode: 'none' }
    | { mode: 'named', name: string }

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

/** The 19 config keys of an ad group template v2 (strict on the API side). */
export interface AdGroupConfig {
  /** null = let TikTok auto-name the ad group */
  adGroupNamePrefix: string | null
  /** `instantPage` → the BO hides data connection + optimization event, the job asks the human */
  placement: Placement
  dataConnection: AdGroupDataConnection
  optimizationEvent: OptimizationEvent
  /** ISO-3166 alpha-2, at least one, no duplicates */
  locations: string[]
  /** empty array = unlimited (`options.ageGroupsUnlimitedLabel`) */
  ageGroups: AgeGroup[]
  gender: Gender
  budget: AdGroupBudget
  schedule: AdGroupSchedule
  timezone: Timezone
  dayparting: Dayparting
  optimizationGoal: OptimizationGoal
  /** null = no cost cap */
  costCap: number | null
  /** v2: `named` replaces the custom targeting keys when the job runs */
  savedAudience: AdGroupSavedAudience
  /** v2: audience names to include / exclude (≤ `listLimits.maxItems` each) */
  audiences: AdGroupAudiences
  /** v2: interest & behaviour names (≤ `listLimits.maxItems`) */
  interests: string[]
  /** v2: language names; `[]` = unlimited (`options.unlimitedLabel`) */
  languages: string[]
  /** v2 */
  spendingPower: SpendingPower
  /** v2: five tri-state toggles */
  advancedPlacement: AdGroupAdvancedPlacement
}

/** Exact key set of the API's template view v2 (`catalogVersion` after `config`). */
export interface AdGroupTemplate {
  id: string
  name: string
  description: string | null
  config: AdGroupConfig
  /**
   * The catalog version the template was authored against (`advertisingGroup/v1`), written by the API.
   * `null` for documents written before FEAT-011 → the table shows the `Older catalog` badge.
   */
  catalogVersion: string | null
  /** `name` is null when the workspace row is gone */
  workspace: { id: string, name: string | null }
  /** `username` is null when the admin row is gone */
  createdBy: { id: string, username: string | null }
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

/** `options.listLimits` — the API's own numbers for every free-text list (FEAT-011 A5). */
export interface AdGroupListLimits {
  maxItems: number
  maxLength: number
}

/**
 * `GET /ad-group-templates/options` 200 body — the 17 label lists plus the BO helpers
 * (`ageGroupsUnlimitedLabel`, `unlimitedLabel`, `minBudget`, `systemDefault`, `catalogVersion`, `listLimits`).
 */
export interface AdGroupTemplateOptions {
  placement: OptionItem[]
  dataConnectionMode: OptionItem[]
  optimizationEvent: OptionItem[]
  locations: OptionItem[]
  ageGroups: OptionItem[]
  gender: OptionItem[]
  budgetType: OptionItem[]
  currency: OptionItem[]
  scheduleMode: OptionItem[]
  startTimeMode: OptionItem[]
  timezone: OptionItem[]
  dayparting: OptionItem[]
  optimizationGoal: OptionItem[]
  /** v2 */
  savedAudienceMode: OptionItem[]
  /** v2 */
  spendingPower: OptionItem[]
  /** v2: `inherit` ↔ `null`, `on` ↔ `true`, `off` ↔ `false` */
  advancedPlacementState: OptionItem[]
  /** v2: the five `config.advancedPlacement` keys, in the order the advanced section renders them */
  advancedPlacementKey: OptionItem[]
  /** shown when no age group is selected */
  ageGroupsUnlimitedLabel: string
  /** v2: shown when a free-text list (Languages) is empty */
  unlimitedLabel: string
  /** minimum `budget.amount` per currency (env `AD_GROUP_MIN_BUDGET`) */
  minBudget: Record<string, number>
  /** TikTok's values on a fresh page — the create form's starting point, never stored */
  systemDefault: AdGroupConfig
  /** v2: the catalog version the API writes on every save (`advertisingGroup/v1`) */
  catalogVersion: string
  /** v2: the limits the BO validates the four tag inputs with */
  listLimits: AdGroupListLimits
}

/** `POST /ad-group-templates` body — `config` is complete (all 19 keys), never `catalogVersion`. */
export interface CreateAdGroupTemplateBody {
  name: string
  description?: string | null
  config: AdGroupConfig
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
