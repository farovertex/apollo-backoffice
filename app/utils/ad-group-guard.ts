/**
 * FEAT-086 — ad group guard helpers shared by `/settings/ad-group-guard`, the account Edit modal, the Launch ads
 * summary and the order page (spec "UI behaviour" §1–§4, api-contract v1 §1).
 *
 * - `formatAdGroupGuardRule(rule, currency)` — the one human sentence of a rule (four shapes, spec §1):
 *   `ใช้จ่าย ≥ 1,500 THB และ (CPM > 200 หรือ conversions < 60)` · `… และ (CPM > 200 และ conversions < 60)` ·
 *   `… และ CPM > 200` · `… และ conversions < 60`; `currency` null → `สกุลของบัญชี`.
 * - `AdGroupGuardRuleDraft` + `parseAdGroupGuardDraft()` — the text inputs of `RuleFields.vue` and the client
 *   validation that mirrors contract §1.1 with the API's own messages (the API's 400 stays the authority).
 */
import type {
  AccountAdGroupGuard,
  AdGroupGuardCombine,
  AdGroupGuardEffective,
  AdGroupGuardMetrics,
  AdGroupGuardMode,
  AdGroupGuardRule,
  AdGroupGuardSource,
  BuildAdGroupGuardGroupState,
  BuildAdGroupGuardState
} from '#shared/types/ad-group-guard'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'

/** shown instead of a currency code when it is unknown or the selection mixes currencies */
export const AGG_ACCOUNT_CURRENCY = 'สกุลของบัญชี'

/** contract §1.1 — the API's 400 texts, copied verbatim */
export const AGG_MESSAGES = {
  minSpend: 'minSpend ต้องเป็นตัวเลขมากกว่า 0',
  maxCpm: 'maxCpm ต้องเป็นตัวเลขมากกว่า 0 หรือ null',
  minConversions: 'minConversions ต้องเป็นจำนวนเต็มตั้งแต่ 1 หรือ null',
  needOne: 'ต้องตั้ง maxCpm หรือ minConversions อย่างน้อยหนึ่งค่า'
} as const

export const AGG_MODE_LABEL: Record<AdGroupGuardMode, string> = {
  inherit: 'ใช้กฎของ workspace',
  custom: 'กำหนดเอง',
  off: 'ไม่ใช้กฎ'
}

export const AGG_COMBINE_LABEL: Record<AdGroupGuardCombine, string> = {
  or: 'เข้าเงื่อนไขใดเงื่อนไขหนึ่ง',
  and: 'ทั้งสองเงื่อนไข'
}

const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
/** metrics are shown whole (spec §4 example `ใช้จ่าย 1,620 THB · CPM 231`) */
const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

function formatWhole(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return WHOLE.format(value)
}

/** `1500` → `1,500`, `231.14` → `231.14` — fixed grouping, never locale-dependent */
export function formatAggNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return NUMBER.format(value)
}

/** spec §1 — the four human shapes of a rule */
export function formatAdGroupGuardRule(rule: AdGroupGuardRule, currency: string | null): string {
  const gate = `ใช้จ่าย ≥ ${formatAggNumber(rule.minSpend)} ${currency || AGG_ACCOUNT_CURRENCY}`
  const cpm = rule.maxCpm !== null ? `CPM > ${formatAggNumber(rule.maxCpm)}` : null
  const conv = rule.minConversions !== null ? `conversions < ${formatAggNumber(rule.minConversions)}` : null
  if (cpm && conv) {
    const join = rule.combine === 'and' ? 'และ' : 'หรือ'
    return `${gate} และ (${cpm} ${join} ${conv})`
  }
  return `${gate} และ ${cpm ?? conv ?? '—'}`
}

/** two rules say the same thing (a missing `combine` reads as `or`, contract §1.1 default) */
export function sameAdGroupGuardRule(a: AdGroupGuardRule | null | undefined, b: AdGroupGuardRule | null | undefined): boolean {
  if (!a || !b) return !a && !b
  const combine = (r: AdGroupGuardRule) => (r.maxCpm !== null && r.minConversions !== null ? (r.combine ?? 'or') : 'or')
  return a.minSpend === b.minSpend
    && a.maxCpm === b.maxCpm
    && a.minConversions === b.minConversions
    && combine(a) === combine(b)
}

// ── draft (text inputs) ───────────────────────────────────────────────────────────────────────────────────────────────
export interface AdGroupGuardRuleDraft {
  minSpend: string
  maxCpm: string
  minConversions: string
  combine: AdGroupGuardCombine
}

export type AdGroupGuardDraftErrors = Partial<Record<'minSpend' | 'maxCpm' | 'minConversions' | 'rule', string>>

export function emptyAdGroupGuardDraft(): AdGroupGuardRuleDraft {
  return { minSpend: '', maxCpm: '', minConversions: '', combine: 'or' }
}

export function adGroupGuardDraftOf(rule: AdGroupGuardRule | null | undefined): AdGroupGuardRuleDraft {
  if (!rule) return emptyAdGroupGuardDraft()
  return {
    minSpend: String(rule.minSpend),
    maxCpm: rule.maxCpm === null ? '' : String(rule.maxCpm),
    minConversions: rule.minConversions === null ? '' : String(rule.minConversions),
    combine: rule.combine ?? 'or'
  }
}

/** `''` → null, a finite number (commas allowed) → the number, anything else → NaN */
function toNumber(text: string): number | null {
  const trimmed = text.replace(/,/g, '').trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

/** both optional conditions are typed — the combine radio is shown only then (spec §1, A4) */
export function adGroupGuardDraftHasBoth(draft: AdGroupGuardRuleDraft): boolean {
  return draft.maxCpm.trim() !== '' && draft.minConversions.trim() !== ''
}

/**
 * contract §1.1 on the client: `rule` when valid (always with an explicit `combine`, `'or'` unless both conditions
 * are set — A4), else the per-field messages. An untouched (all empty) draft is invalid too.
 */
export function parseAdGroupGuardDraft(draft: AdGroupGuardRuleDraft):
  { rule: AdGroupGuardRule, errors: null } | { rule: null, errors: AdGroupGuardDraftErrors } {
  const errors: AdGroupGuardDraftErrors = {}
  const minSpend = toNumber(draft.minSpend)
  const maxCpm = toNumber(draft.maxCpm)
  const minConversions = toNumber(draft.minConversions)
  if (minSpend === null || Number.isNaN(minSpend) || minSpend <= 0) errors.minSpend = AGG_MESSAGES.minSpend
  if (maxCpm !== null && (Number.isNaN(maxCpm) || maxCpm <= 0)) errors.maxCpm = AGG_MESSAGES.maxCpm
  if (minConversions !== null && (Number.isNaN(minConversions) || !Number.isInteger(minConversions) || minConversions < 1)) {
    errors.minConversions = AGG_MESSAGES.minConversions
  }
  if (maxCpm === null && minConversions === null) errors.rule = AGG_MESSAGES.needOne
  if (Object.keys(errors).length > 0) return { rule: null, errors }
  return {
    rule: {
      minSpend: minSpend as number,
      maxCpm,
      minConversions,
      combine: maxCpm !== null && minConversions !== null ? draft.combine : 'or'
    },
    errors: null
  }
}

// ── account layer ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** the account's own layer; a row without the key (older API / stub) reads as `inherit` (spec AC-9) */
export function accountAdGroupGuard(account: Pick<TikTokAccount, 'adGroupGuard'> | null | undefined): AccountAdGroupGuard {
  const block = account?.adGroupGuard
  if (!block || (block.mode !== 'custom' && block.mode !== 'off' && block.mode !== 'inherit')) {
    return { mode: 'inherit', rule: null, updatedAt: null }
  }
  return { mode: block.mode, rule: block.mode === 'custom' ? block.rule ?? null : null, updatedAt: block.updatedAt ?? null }
}

/** `GET /launch/targets` advertiser block, an absent key = no rule */
export function effectiveOrNone(block: AdGroupGuardEffective | null | undefined): AdGroupGuardEffective {
  return block ?? { rule: null, source: 'none', currency: null }
}

// ── labels ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const AGG_SOURCE_LABEL: Record<AdGroupGuardSource, string> = {
  order: 'กฎของ order',
  account: 'กฎของบัญชี',
  workspace: 'กฎของ workspace',
  none: 'ไม่มีกฎ'
}

/** spec §4 — the source badge; `rule: null` with `order` / `account` = switched off at that layer */
export function adGroupGuardSourceLabel(source: AdGroupGuardSource, hasRule: boolean): string {
  if (!hasRule && source === 'order') return 'ปิดที่ order'
  if (!hasRule && source === 'account') return 'ปิดที่บัญชี'
  return AGG_SOURCE_LABEL[source] ?? source
}

type BadgeColor = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'primary'

export const AGG_BUILD_STATE: Record<BuildAdGroupGuardState, { label: string, color: BadgeColor }> = {
  off: { label: 'ไม่มีกฎปิด ad group', color: 'neutral' },
  watching: { label: 'กำลังเฝ้า', color: 'info' },
  done: { label: 'จบแล้ว', color: 'success' }
}

export const AGG_GROUP_STATE: Record<BuildAdGroupGuardGroupState, { label: string, color: BadgeColor }> = {
  watching: { label: 'เฝ้าอยู่', color: 'info' },
  queued: { label: 'สั่งปิดแล้ว รอ job', color: 'warning' },
  paused: { label: 'ปิดแล้ว', color: 'success' },
  failed: { label: 'ปิดไม่สำเร็จ', color: 'error' }
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** `29 ต.ค. 14:05` (browser timezone) — `''` for null / unparsable */
export function formatAggDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** spec §4 — `ใช้จ่าย 1,620 THB · CPM 231 · conv 12 · ณ 29 ต.ค. 14:05` */
export function formatAdGroupGuardMetrics(metrics: AdGroupGuardMetrics, currency: string | null): string {
  const parts = [
    `ใช้จ่าย ${formatWhole(metrics.spend)} ${currency || AGG_ACCOUNT_CURRENCY}`,
    `CPM ${formatWhole(metrics.cpm)}`,
    `conv ${formatWhole(metrics.conversions)}`
  ]
  const at = formatAggDate(metrics.asOf)
  if (at) parts.push(`ณ ${at}`)
  return parts.join(' · ')
}

/** group name, fallback `…<last 4 of id>` */
export function adGroupGuardGroupName(name: string | null | undefined, tiktokAdGroupId: string): string {
  return name?.trim() || `…${tiktokAdGroupId.slice(-4)}`
}
