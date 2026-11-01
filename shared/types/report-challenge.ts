/**
 * FEAT-094 — `GET /reports/challenge` (api-contract.md v1 §2/§4). 1:1 with the response; the ranking, the
 * Dep/Budget %, the deltas, the gaps and the team ratio are all computed in the BO from these sums
 * (`app/utils/report-challenge.ts`) — the API only sorts `people` by spend.
 */
import type { FxReportBlock, SpendFxRow } from './fx'
import type { ReportRangeInfo } from './reports'

export interface ChallengeAdminRef {
  id: string
  displayName: string | null
}

export interface ChallengeWorkspaceRef {
  id: string
  name: string | null
}

/** `launching.list[].account` — no `loginEmail` (A1: other admins' account emails are never sent) */
export interface ChallengeAccountRef {
  id: string
  label: string | null
}

export type ChallengeDeliveryState = 'delivering' | 'notDelivering' | 'unknown'

export interface ChallengeLaunchingRow {
  advertiserId: string
  name: string | null
  tiktokAdvertiserId: string | null
  account: ChallengeAccountRef | null
  state: ChallengeDeliveryState
  reasons: string[]
  since: string | null
  spend: number
}

/** range-independent "now" block */
export interface ChallengeLaunching {
  total: number
  delivering: number
  notDelivering: number
  unknown: number
  /** ≤ 50; `total` is the real count */
  list: ChallengeLaunchingRow[]
}

export interface ChallengeTopAd {
  adId: string
  creativeName: string
  campaignName: string
  conversions: number
  spend: number
  coverUrl: string | null
  isVideo: boolean
  advertiserId: string
  tiktokAccountId: string
  campaignId: string
}

export interface ChallengePrevious {
  spend: number
  deposit: number
}

/** one card (= one workspace owner) */
export interface ChallengePerson extends SpendFxRow {
  admin: ChallengeAdminRef
  workspaces: ChallengeWorkspaceRef[]
  spend: number
  deposit: number
  depositors: number
  registers: number
  withdraw: number
  /** `null` for `range=all` */
  previous: ChallengePrevious | null
  launching: ChallengeLaunching
  /** ≤ 3, conversions > 0 only */
  topAds: ChallengeTopAd[]
}

export interface ChallengeTeamLaunching {
  total: number
  delivering: number
  notDelivering: number
  unknown: number
}

export interface ChallengeTeam {
  spend: number
  deposit: number
  depositors: number
  registers: number
  launching: ChallengeTeamLaunching
}

export interface ChallengeResponse {
  range: ReportRangeInfo
  previous: { from: string | null, to: string | null } | null
  refreshedAt: string | null
  utmFetchedAt: string | null
  /** the caller's own admin id — always present, also for GOD, also when not in `people` */
  me: { adminId: string }
  /** sorted `spend` desc, then `displayName` asc, then `admin.id` asc (the BO re-ranks by `by`) */
  people: ChallengePerson[]
  team: ChallengeTeam
  fx: FxReportBlock
}

/** `?by=` of `/reports/challenge` (default `depBudget`, omitted from the URL) */
export type ChallengeBy = 'depBudget' | 'deposit'
