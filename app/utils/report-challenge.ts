/**
 * FEAT-094 — the pure, unit-testable helpers of `/reports/challenge` (api-contract.md v1 §4). The API only
 * sorts `people` by spend; every ranking, delta, gap and the team ratio is computed here from the API's own
 * sums (spec A5). Nothing here calls the network or reads the URL.
 */
import type { ChallengeBy, ChallengePerson } from '#shared/types/report-challenge'
import type { ReportRange } from '#shared/types/reports'

/** depBudget → Dep/Budget % (`null` when spend is 0) · deposit → the deposit amount itself */
export function challengeValue(person: ChallengePerson, by: ChallengeBy): number | null {
  return by === 'depBudget' ? depPerBudgetPct(person.deposit, person.spend) : person.deposit
}

export interface ChallengeRanked {
  person: ChallengePerson
  value: number | null
  /** `null` = unranked (depBudget with spend 0); 1-based otherwise */
  rank: number | null
}

/**
 * Ranked people (value non-null) by value desc, then `displayName` asc, then admin id, numbered 1..N;
 * unranked people follow, sorted by `displayName` only, with `rank: null`.
 */
export function rankPeople(people: ChallengePerson[], by: ChallengeBy): ChallengeRanked[] {
  const withValue = people.map(person => ({ person, value: challengeValue(person, by) }))

  const byName = (a: ChallengePerson, b: ChallengePerson) => {
    const an = a.admin.displayName ?? ''
    const bn = b.admin.displayName ?? ''
    if (an !== bn) return an.localeCompare(bn)
    return a.admin.id.localeCompare(b.admin.id)
  }

  const ranked = withValue
    .filter((r): r is { person: ChallengePerson, value: number } => r.value !== null)
    .sort((a, b) => (b.value !== a.value ? b.value - a.value : byName(a.person, b.person)))

  const unranked = withValue
    .filter(r => r.value === null)
    .sort((a, b) => byName(a.person, b.person))

  return [
    ...ranked.map((r, i) => ({ person: r.person, value: r.value, rank: i + 1 })),
    ...unranked.map(r => ({ person: r.person, value: r.value, rank: null }))
  ]
}

export interface ChallengeDelta {
  dir: 'up' | 'down' | 'flat' | 'none'
  /** `null` only for `dir: 'none'`; rounded to 0 decimals otherwise */
  pct: number | null
}

/**
 * `none` when either side is null or the previous value is 0; `flat` when the relative change is under
 * 0.5 %; else the sign of the change. `pct` = `|cur − prev| / |prev| × 100`, rounded to 0 decimals.
 */
export function challengeDelta(cur: number | null, prev: number | null): ChallengeDelta {
  if (cur === null || prev === null || prev === 0 || !Number.isFinite(prev)) return { dir: 'none', pct: null }
  const diff = cur - prev
  const pct = (Math.abs(diff) / Math.abs(prev)) * 100
  if (pct < 0.5) return { dir: 'flat', pct: Math.round(pct) }
  return { dir: diff > 0 ? 'up' : 'down', pct: Math.round(pct) }
}

/** `|a − b|` formatted for the "my line" gap sentence: depBudget → `NN%` (points) · deposit → `formatThb`. */
export function gapText(by: ChallengeBy, a: number, b: number): string {
  const diff = Math.abs(a - b)
  return by === 'depBudget' ? `${Math.round(diff)}%` : formatThb(diff, 0)
}

/** `'จากเมื่อวาน'` for `today`, `'จากช่วงก่อน'` otherwise — the delta line's trailing suffix. */
export function deltaSuffix(rangeKey: ReportRange): string {
  return rangeKey === 'today' ? 'จากเมื่อวาน' : 'จากช่วงก่อน'
}
