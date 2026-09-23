/**
 * FEAT-008 — `/ad-group-templates` (apollo-api, function 6.8). Mirrors
 * mission-control/.ai/features/FEAT-008-ad-group-template/api-contract.md v1
 * ("Template view", `GET /options`, `GET/POST/PATCH/DELETE /ad-group-templates`).
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

export type Placement = 'website'
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

/** The 13 config keys of an ad group template (strict on the API side). */
export interface AdGroupConfig {
  /** null = let TikTok auto-name the ad group */
  adGroupNamePrefix: string | null
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
}

/** Exact key set of the API's template view. */
export interface AdGroupTemplate {
  id: string
  name: string
  description: string | null
  config: AdGroupConfig
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

/**
 * `GET /ad-group-templates/options` 200 body — the 13 label lists plus the three BO helpers
 * (`ageGroupsUnlimitedLabel`, `minBudget`, `systemDefault`).
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
  /** shown when no age group is selected */
  ageGroupsUnlimitedLabel: string
  /** minimum `budget.amount` per currency (env `AD_GROUP_MIN_BUDGET`) */
  minBudget: Record<string, number>
  /** TikTok's values on a fresh page — the create form's starting point, never stored */
  systemDefault: AdGroupConfig
}

/** `POST /ad-group-templates` body — `config` is complete (all 13 keys). */
export interface CreateAdGroupTemplateBody {
  name: string
  description?: string | null
  config: AdGroupConfig
}

/**
 * `PATCH /ad-group-templates/:id` body — **only the changed keys**. `config` is a partial at the
 * top level: each present key carries its complete value and replaces the stored one wholesale (A3).
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
