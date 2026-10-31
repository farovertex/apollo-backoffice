/**
 * FEAT-086 / FEAT-087 — ad group guard helpers shared by `/settings/ad-group-guard`, the account Edit modal, the
 * Launch ads summary and the order page (FEAT-087 spec "UI behaviour" §1–§5, api-contract v1 §1).
 *
 * FEAT-087: the rule is an expression tree (`{ combine, items }`, items = conditions `{ metric, op, value, value2? }`
 * or nested groups). This file holds the BO copy of the metric catalog (A5 — must stay identical to the API's
 * `AD_GROUP_GUARD_METRICS`), the operators, the API's 400 messages verbatim, the **draft** tree the
 * `RuleBuilder.vue` form edits (strings), `parseAdGroupGuardDraft()` (client mirror of contract §1.1, the API's 400
 * stays the authority) and the formatters (`formatAdGroupGuardRule` = the one sentence QA asserts verbatim).
 *
 * Paths: `data-path` of rows/groups = dot-joined indexes from the root (`'0'`, `'1.0'`) — the same as the API's
 * `hits`. Error keys = the zod sub-path below the rule prefix (`items.1.items.0.value`; `''` = the rule itself).
 */
import type {
  AccountAdGroupGuard,
  AdGroupGuardCombine,
  AdGroupGuardCondition,
  AdGroupGuardEffective,
  AdGroupGuardGroup,
  AdGroupGuardMetricKey,
  AdGroupGuardMetrics,
  AdGroupGuardMode,
  AdGroupGuardNode,
  AdGroupGuardOp,
  AdGroupGuardRule,
  AdGroupGuardSource,
  BuildAdGroupGuardGroupState,
  BuildAdGroupGuardState
} from '#shared/types/ad-group-guard'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'

/** shown instead of a currency code when it is unknown or the selection mixes currencies */
export const AGG_ACCOUNT_CURRENCY = 'สกุลของบัญชี'

// ── catalog (contract §1.1 — array order = display order) ─────────────────────────────────────────────────────────────
export type AdGroupGuardUnit = 'currency' | 'count' | 'percent'
export type AdGroupGuardKind = 'decimal' | 'integer'

export interface AdGroupGuardMetricDef {
  key: AdGroupGuardMetricKey
  label: string
  unit: AdGroupGuardUnit
  kind: AdGroupGuardKind
}

/**
 * adding a metric = one row here (and one in the API catalog) — no form change
 * TASK-guard-metric-names (2026-10-31): labels + order = the Ads monitor column headers (`ads-monitor/Table.vue`
 * `METRIC_COLUMNS`: Spend CPC CPM Impressions Clicks CTR Conversions CPA CVR); `conversionRate` (CVR) added
 */
export const AGG_METRICS: readonly AdGroupGuardMetricDef[] = [
  { key: 'spend', label: 'Spend', unit: 'currency', kind: 'decimal' },
  { key: 'cpc', label: 'CPC', unit: 'currency', kind: 'decimal' },
  { key: 'cpm', label: 'CPM', unit: 'currency', kind: 'decimal' },
  { key: 'impressions', label: 'Impressions', unit: 'count', kind: 'integer' },
  { key: 'clicks', label: 'Clicks', unit: 'count', kind: 'integer' },
  { key: 'ctr', label: 'CTR', unit: 'percent', kind: 'decimal' },
  { key: 'conversions', label: 'Conversions', unit: 'count', kind: 'integer' },
  { key: 'conversionCost', label: 'CPA', unit: 'currency', kind: 'decimal' },
  { key: 'conversionRate', label: 'CVR', unit: 'percent', kind: 'decimal' }
]

export const AGG_METRIC_BY_KEY = Object.fromEntries(AGG_METRICS.map(m => [m.key, m])) as Record<AdGroupGuardMetricKey, AdGroupGuardMetricDef>

export interface AdGroupGuardOpDef {
  key: AdGroupGuardOp
  symbol: string
  label: string
}

/** contract §1.1 operators; `label` = what the op select shows */
export const AGG_OPS: readonly AdGroupGuardOpDef[] = [
  { key: 'gt', symbol: '>', label: '> มากกว่า' },
  { key: 'gte', symbol: '≥', label: '≥ ตั้งแต่' },
  { key: 'lt', symbol: '<', label: '< น้อยกว่า' },
  { key: 'lte', symbol: '≤', label: '≤ ไม่เกิน' },
  { key: 'between', symbol: 'ระหว่าง', label: 'ระหว่าง' }
]

export const AGG_OP_BY_KEY = Object.fromEntries(AGG_OPS.map(o => [o.key, o])) as Record<AdGroupGuardOp, AdGroupGuardOpDef>

/** contract §1.1 — the API's 400 texts, copied verbatim, + the builder's own rule-level lines (spec §1) */
export const AGG_MESSAGES = {
  group: 'rule ต้องเป็น { combine, items }',
  combine: 'combine ต้องเป็น or หรือ and',
  items: 'ต้องมีอย่างน้อยหนึ่งเงื่อนไข',
  item: 'เงื่อนไขต้องเป็น { metric, op, value } หรือกลุ่ม { combine, items }',
  metric: 'metric ต้องเป็น spend, cpc, cpm, impressions, clicks, ctr, conversions, conversionCost หรือ conversionRate',
  op: 'op ต้องเป็น gt, gte, lt, lte หรือ between',
  value: 'value ต้องเป็นตัวเลขตั้งแต่ 0',
  valueInt: 'value ต้องเป็นจำนวนเต็มตั้งแต่ 0',
  value2: 'value2 ต้องเป็นตัวเลขมากกว่า value',
  value2Int: 'value2 ต้องเป็นจำนวนเต็มมากกว่า value',
  value2Only: 'value2 ใช้ได้เฉพาะ op between',
  depth: 'กลุ่มซ้อนได้ไม่เกิน 4 ชั้น',
  size: 'เงื่อนไขรวมต้องไม่เกิน 20',
  /** builder only (spec §1) */
  incomplete: 'ใส่ตัวเลขให้ครบทุกเงื่อนไข (ระหว่าง: ค่าหลังต้องมากกว่าค่าหน้า)',
  groupEmpty: 'วงเล็บต้องมีอย่างน้อยหนึ่งเงื่อนไข',
  spendWarn: 'ยังไม่มีเงื่อนไข Spend — กลุ่มใหม่มักมี CPM สูงช่วงแรก'
} as const

/** contract §1.1 guard rails (A6) */
export const AGG_MAX_DEPTH = 4
export const AGG_MAX_CONDITIONS = 20

export const AGG_MODE_LABEL: Record<AdGroupGuardMode, string> = {
  inherit: 'ใช้กฎของ workspace',
  custom: 'กำหนดเอง',
  off: 'ไม่ใช้กฎ'
}

/** the connector pill texts */
export const AGG_COMBINE_LABEL: Record<AdGroupGuardCombine, string> = {
  and: 'และ',
  or: 'หรือ'
}

/** `en-US` grouping, up to 3 decimals — the same output as `Number.prototype.toLocaleString('en-US')` */
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 })
/** metrics line (≤ 2 decimals, as the API's log line) */
const NUMBER2 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

/** `1500` → `1,500`, `1620.5` → `1,620.5` — fixed grouping, never locale-dependent */
export function formatAggNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return NUMBER.format(value)
}

function unitText(unit: AdGroupGuardUnit, currency: string | null): string {
  if (unit === 'currency') return ` ${currency || AGG_ACCOUNT_CURRENCY}`
  if (unit === 'percent') return '%'
  return ''
}

/** the unit suffix of a metric's input: currency code / `สกุลของบัญชี`, `%`, or `''` */
export function adGroupGuardUnitLabel(metric: AdGroupGuardMetricKey, currency: string | null): string {
  return unitText(AGG_METRIC_BY_KEY[metric]?.unit ?? 'count', currency).trim()
}

export function isAdGroupGuardGroup(node: AdGroupGuardNode): node is AdGroupGuardGroup {
  return Array.isArray((node as AdGroupGuardGroup).items)
}

// ── sentence (contract §1.4) ──────────────────────────────────────────────────────────────────────────────────────────
/** a rule whose numbers may be missing (`null` → `…`) — the draft as the sentence sees it */
interface LooseCondition { metric: AdGroupGuardMetricKey, op: AdGroupGuardOp, value: number | null, value2?: number | null }
interface LooseGroup { combine: AdGroupGuardCombine, items: (LooseCondition | LooseGroup)[] }

function fmtN(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? '…' : NUMBER.format(value)
}

function formatLooseCondition(c: LooseCondition, currency: string | null): string {
  const def = AGG_METRIC_BY_KEY[c.metric]
  const label = def?.label ?? c.metric
  const unit = unitText(def?.unit ?? 'count', currency)
  if (c.op === 'between') return `${label} ระหว่าง ${fmtN(c.value)}–${fmtN(c.value2)}${unit}`
  return `${label} ${AGG_OP_BY_KEY[c.op]?.symbol ?? c.op} ${fmtN(c.value)}${unit}`
}

function formatLooseGroup(g: LooseGroup, currency: string | null, nested: boolean): string {
  if (!g.items.length) return nested ? '( … )' : '…'
  const sep = g.combine === 'and' ? ' และ ' : ' หรือ '
  const text = g.items
    .map(item => ('items' in item ? formatLooseGroup(item, currency, true) : formatLooseCondition(item, currency)))
    .join(sep)
  return nested ? `(${text})` : text
}

/** `Spend ≥ 1,500 THB และ (CPM > 200 THB หรือ Conversions < 60)` — `currency` null → `สกุลของบัญชี` */
export function formatAdGroupGuardRule(rule: AdGroupGuardRule, currency: string | null): string {
  return formatLooseGroup(rule, currency, false)
}

/** one condition: `CPM > 200 THB` · `Spend ระหว่าง 1,000–3,000 THB` */
export function formatAdGroupGuardCondition(condition: AdGroupGuardCondition, currency: string | null): string {
  return formatLooseCondition(condition, currency)
}

/** the metrics a rule uses, catalog order, each once */
export function ruleMetrics(rule: AdGroupGuardRule | null | undefined): AdGroupGuardMetricKey[] {
  const used = new Set<AdGroupGuardMetricKey>()
  const walk = (g: AdGroupGuardGroup) => {
    for (const item of g.items) {
      if (isAdGroupGuardGroup(item)) walk(item)
      else used.add(item.metric)
    }
  }
  if (rule) walk(rule)
  return AGG_METRICS.map(m => m.key).filter(k => used.has(k))
}

/** the normalized view of a tree (contract §1.1 "View"): fixed key order, `value2` only with `between` */
function normalizeNode(node: AdGroupGuardNode): AdGroupGuardNode {
  if (isAdGroupGuardGroup(node)) return { combine: node.combine, items: node.items.map(normalizeNode) }
  const c: AdGroupGuardCondition = { metric: node.metric, op: node.op, value: node.value }
  if (node.op === 'between') c.value2 = node.value2
  return c
}

export function normalizeAdGroupGuardRule(rule: AdGroupGuardRule): AdGroupGuardRule {
  return normalizeNode(rule) as AdGroupGuardRule
}

/** deep equality of the normalized trees (item order matters, as the API keeps it) */
export function sameAdGroupGuardRule(a: AdGroupGuardRule | null | undefined, b: AdGroupGuardRule | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return JSON.stringify(normalizeAdGroupGuardRule(a)) === JSON.stringify(normalizeAdGroupGuardRule(b))
}

// ── draft (the builder's tree of strings) ─────────────────────────────────────────────────────────────────────────────
export interface AdGroupGuardConditionDraft {
  kind: 'condition'
  /** client-only stable id for `v-for` / touched state — never sent */
  uid: string
  metric: AdGroupGuardMetricKey
  op: AdGroupGuardOp
  value: string
  value2: string
}

export interface AdGroupGuardGroupDraft {
  kind: 'group'
  uid: string
  combine: AdGroupGuardCombine
  items: AdGroupGuardNodeDraft[]
}

export type AdGroupGuardNodeDraft = AdGroupGuardConditionDraft | AdGroupGuardGroupDraft
/** the builder's v-model — the root is a group */
export type AdGroupGuardDraft = AdGroupGuardGroupDraft
/** spec §1 name of the same thing */
export type AdGroupGuardRuleDraft = AdGroupGuardDraft
/** keyed by the zod sub-path below the rule prefix (`items.1.items.0.value`); `''` = the rule itself */
export type AdGroupGuardDraftErrors = Record<string, string>

let draftSeq = 0
function nextUid(): string {
  draftSeq += 1
  return `agg${draftSeq}`
}

/** spec §1 — a new condition is `cpm > ''` */
export function newAdGroupGuardCondition(metric: AdGroupGuardMetricKey = 'cpm', op: AdGroupGuardOp = 'gt'): AdGroupGuardConditionDraft {
  return { kind: 'condition', uid: nextUid(), metric, op, value: '', value2: '' }
}

/** spec §1 — a new group is `or` with one new condition */
export function newAdGroupGuardGroup(): AdGroupGuardGroupDraft {
  return { kind: 'group', uid: nextUid(), combine: 'or', items: [newAdGroupGuardCondition()] }
}

/** spec §2 — `and` + one `spend ≥ ''` condition */
export function emptyAdGroupGuardDraft(): AdGroupGuardDraft {
  return { kind: 'group', uid: nextUid(), combine: 'and', items: [newAdGroupGuardCondition('spend', 'gte')] }
}

function draftNodeOf(node: AdGroupGuardNode): AdGroupGuardNodeDraft {
  if (isAdGroupGuardGroup(node)) {
    return { kind: 'group', uid: nextUid(), combine: node.combine, items: node.items.map(draftNodeOf) }
  }
  return {
    kind: 'condition',
    uid: nextUid(),
    metric: node.metric,
    op: node.op,
    value: String(node.value),
    value2: node.op === 'between' && typeof node.value2 === 'number' ? String(node.value2) : ''
  }
}

/** a stored rule → the builder's draft; no rule (or an unreadable one) → the default draft */
export function adGroupGuardDraftOf(rule: AdGroupGuardRule | null | undefined): AdGroupGuardDraft {
  if (!rule || !Array.isArray(rule.items)) return emptyAdGroupGuardDraft()
  return draftNodeOf(rule) as AdGroupGuardDraft
}

/** a deep copy (fresh object graph, same uids) — the builder edits copies and assigns them back */
export function cloneAdGroupGuardDraft(draft: AdGroupGuardDraft): AdGroupGuardDraft {
  return JSON.parse(JSON.stringify(draft)) as AdGroupGuardDraft
}

/** `''` → null, a finite number (commas allowed) → the number, anything else → NaN */
function toNumber(text: string): number | null {
  const trimmed = String(text ?? '').replace(/,/g, '').trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

/** `[1, 0]` → `items.1.items.0` (zod sub-path below the rule prefix) */
export function aggSubPath(indexes: readonly number[]): string {
  return indexes.map(i => `items.${i}`).join('.')
}

/** `[1, 0]` → `1.0` (`data-path`, same as the API's `hits`) */
export function aggDataPath(indexes: readonly number[]): string {
  return indexes.join('.')
}

function pathJoin(prefix: string, part: string): string {
  return prefix ? `${prefix}.${part}` : part
}

function countConditions(g: AdGroupGuardGroupDraft): number {
  return g.items.reduce((n, item) => n + (item.kind === 'group' ? countConditions(item) : 1), 0)
}

/** the draft as the sentence / JSON preview sees it: invalid numbers → `null` */
function looseOf(g: AdGroupGuardGroupDraft): LooseGroup {
  return {
    combine: g.combine,
    items: g.items.map((item): LooseCondition | LooseGroup => {
      if (item.kind === 'group') return looseOf(item)
      const value = toNumber(item.value)
      const c: LooseCondition = { metric: item.metric, op: item.op, value: value === null || Number.isNaN(value) ? null : value }
      if (item.op === 'between') {
        const value2 = toNumber(item.value2)
        c.value2 = value2 === null || Number.isNaN(value2) ? null : value2
      }
      return c
    })
  }
}

/** the live sentence of a (possibly invalid) draft — invalid numbers render as `…` */
export function formatAdGroupGuardDraft(draft: AdGroupGuardDraft, currency: string | null): string {
  return formatLooseGroup(looseOf(draft), currency, false)
}

/** the body the builder would send (invalid numbers as `null`) — the `ดู JSON` preview while invalid */
export function adGroupGuardDraftPreview(draft: AdGroupGuardDraft): unknown {
  return looseOf(draft)
}

/**
 * contract §1.1 on the client, with the API's messages verbatim: `{ rule }` when valid, else the errors keyed by
 * zod sub-path (`items.1.items.0.value`; `items` = root empty; `''` = more than 20 conditions).
 */
export function parseAdGroupGuardDraft(draft: AdGroupGuardDraft):
  { rule: AdGroupGuardRule, errors: null } | { rule: null, errors: AdGroupGuardDraftErrors } {
  const errors: AdGroupGuardDraftErrors = {}

  const condition = (c: AdGroupGuardConditionDraft, path: string): AdGroupGuardCondition => {
    const def = AGG_METRIC_BY_KEY[c.metric]
    const integer = def?.kind === 'integer'
    if (!def) errors[pathJoin(path, 'metric')] = AGG_MESSAGES.metric
    if (!AGG_OP_BY_KEY[c.op]) errors[pathJoin(path, 'op')] = AGG_MESSAGES.op
    // contract v1.1 §10 — message precedence: not a finite number ≥ 0 first, then the integer rule
    const value = toNumber(c.value)
    const valueNum = value !== null && !Number.isNaN(value) && value >= 0
    if (!valueNum) errors[pathJoin(path, 'value')] = AGG_MESSAGES.value
    else if (integer && !Number.isInteger(value)) errors[pathJoin(path, 'value')] = AGG_MESSAGES.valueInt
    const out: AdGroupGuardCondition = { metric: c.metric, op: c.op, value: value ?? 0 }
    if (c.op === 'between') {
      // §10: missing / not a number → value2 message; else integer rule; else `≤ value`
      const value2 = toNumber(c.value2)
      if (value2 === null || Number.isNaN(value2) || value2 < 0) {
        errors[pathJoin(path, 'value2')] = AGG_MESSAGES.value2
      } else if (integer && !Number.isInteger(value2)) {
        errors[pathJoin(path, 'value2')] = AGG_MESSAGES.value2Int
      } else if (valueNum && value2 <= (value as number)) {
        errors[pathJoin(path, 'value2')] = AGG_MESSAGES.value2
      }
      out.value2 = value2 ?? 0
    }
    return out
  }

  const group = (g: AdGroupGuardGroupDraft, path: string, depth: number): AdGroupGuardGroup => {
    if (depth > AGG_MAX_DEPTH) errors[path] = AGG_MESSAGES.depth
    if (!g.items.length) errors[pathJoin(path, 'items')] = AGG_MESSAGES.items
    return {
      combine: g.combine,
      items: g.items.map((item, i) => (item.kind === 'group'
        ? group(item, pathJoin(path, `items.${i}`), depth + 1)
        : condition(item, pathJoin(path, `items.${i}`))))
    }
  }

  const rule = group(draft, '', 1)
  if (countConditions(draft) > AGG_MAX_CONDITIONS) errors[''] = errors[''] ?? AGG_MESSAGES.size
  if (Object.keys(errors).length) return { rule: null, errors }
  return { rule: normalizeAdGroupGuardRule(rule), errors: null }
}

/** the draft has a condition on `spend` somewhere (spec §1 — warning only) */
export function adGroupGuardDraftUsesSpend(draft: AdGroupGuardGroupDraft): boolean {
  return draft.items.some(item => (item.kind === 'group' ? adGroupGuardDraftUsesSpend(item) : item.metric === 'spend'))
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

/**
 * spec §5 — the metrics the rule uses (catalog order) as `<label> <n><unit>`, a null rate as `<label> —`, then
 * ` · ณ <date>`: `Spend 1,620 THB · CPM 231.03 THB · Conversions 12 · ณ 29 ต.ค. 14:05`
 */
export function formatAdGroupGuardMetrics(metrics: AdGroupGuardMetrics, rule: AdGroupGuardRule | null, currency: string | null): string {
  const parts = ruleMetrics(rule).map((metric) => {
    const def = AGG_METRIC_BY_KEY[metric]
    const value = metrics[metric]
    if (value === null || value === undefined || !Number.isFinite(value)) return `${def.label} —`
    return `${def.label} ${NUMBER2.format(value)}${unitText(def.unit, currency)}`
  })
  const at = formatAggDate(metrics.asOf)
  if (at) parts.push(`ณ ${at}`)
  return parts.join(' · ')
}

/** compare `'1.0'` / `'10'` by numeric segments */
function comparePaths(a: string, b: string): number {
  const x = a.split('.').map(Number)
  const y = b.split('.').map(Number)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1)
    if (d) return d
  }
  return 0
}

/** the condition at a `hits` path (`'1.0'`), or null when the path is not a condition of the rule */
function conditionAt(rule: AdGroupGuardRule, path: string): AdGroupGuardCondition | null {
  let node: AdGroupGuardNode = rule
  for (const part of path.split('.')) {
    if (!isAdGroupGuardGroup(node)) return null
    const next: AdGroupGuardNode | undefined = node.items[Number(part)]
    if (!next) return null
    node = next
  }
  return isAdGroupGuardGroup(node) ? null : node
}

/** spec §5 — `เข้าเงื่อนไข: Spend ≥ 1,500 THB · CPM > 200 THB` (path order, no parentheses); `null` = no line */
export function formatAdGroupGuardHits(rule: AdGroupGuardRule | null, hits: string[] | null | undefined, currency: string | null): string | null {
  if (!rule || !hits?.length) return null
  const parts = [...hits]
    .sort(comparePaths)
    .map(path => conditionAt(rule, path))
    .filter((c): c is AdGroupGuardCondition => c !== null)
    .map(c => formatLooseCondition(c, currency))
  return parts.length ? `เข้าเงื่อนไข: ${parts.join(' · ')}` : null
}

/** group name, fallback `…<last 4 of id>` */
export function adGroupGuardGroupName(name: string | null | undefined, tiktokAdGroupId: string): string {
  return name?.trim() || `…${tiktokAdGroupId.slice(-4)}`
}
