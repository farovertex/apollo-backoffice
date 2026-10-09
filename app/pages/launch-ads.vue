<script setup lang="ts">
/**
 * FEAT-016 — Launch ads (functions 6.2–6.4; api-contract.md **v1** `GET /launch/targets`,
 * `POST /campaign-orders`; spec AC-12…AC-16). One page, three steps, one state: going back never loses
 * anything and the next step opens only when the current one is complete.
 *
 * Step 1 · Accounts — account-first picker over **one** `GET /backend/launch/targets` per page open / Refresh.
 *   Only `available` accounts are in the table; for each one the API already picked the advertiser with the
 *   lowest `bcOrder` (`defaultAdvertiserId`, shown with the `auto` badge). Expanding a row lists **every**
 *   advertiser of the account with its badge; only `selectable` ones (active + not missing) have an enabled
 *   radio, and picking one selects the account. 1 advertiser per account this round
 *   (`limits.maxAdvertisersPerAccount`). Everything else sits in the collapsed `Unavailable (N)` strip with the
 *   reason texts of api-contract §4 (`app/utils/launch-reasons.ts`). Search and the workspace filter are
 *   client-side over that one response (spec A6); the workspace filter is hidden with a single workspace.
 *
 *   FEAT-026 / FEAT-034 — "Only with balance" (`la-acc-funded`) is **on** at every page open (not persisted, A4):
 *   the table then lists only available accounts with a funded Business Center and ≥ 1 `selectable` advertiser
 *   (`isFunded`), composed with search/workspace by AND, client-side, no extra request. TikTok keeps one shared
 *   cash balance per Business Center (FEAT-034), so funding is a property of the **account** now
 *   (`account.hasBalance`), not of an individual advertiser — the old funded-first default-advertiser rule
 *   collapses (AS-8): the shown/auto-picked advertiser of a row (`advertiserOf`/`isAutoAdvertiser`/`setSelected`)
 *   is the API's `defaultAdvertiserId` when it is still `selectable`, else the first `selectable` advertiser of
 *   the account — an explicit `selection` pick always wins. Turning the switch **on** drops every unfunded
 *   account from `selection` (A6) and re-resolves every remaining **auto** selection to that computed default
 *   (BUG-027: only a radio pick the user actually made, tracked in `manualPicks`, counts as explicit — the
 *   advertiser that select-all/the row checkbox wrote in is the default of the moment, not a decision);
 *   turning it off keeps the selection. The header checkbox (`la-acc-select-all`)
 *   replaces the old "Select all" button: true/indeterminate/false over the **visible** rows only, and acts
 *   on those same visible rows (`toggleSelectAllVisible`). `la-acc-unfunded-hint`/`la-acc-nofunded` explain
 *   and undo the filter (`la-acc-show-all`); `la-acc-clear-search` also turns the switch off. The account row
 *   shows the account's own balance (`la-acc-balance`, `<account.balanceAmount> <account.balanceCurrency>` or
 *   `—`, title = last read time); advertiser options carry no balance of their own any more.
 * Step 2 · Templates — the existing list endpoints (`?limit=100`) + their `/options`, requested **once per
 *   page lifetime** when the step is first opened. A card whose `catalogVersion` differs from the one
 *   `/options` serves is disabled with the re-save message (spec A8) — the API refuses it anyway (400).
 *   Copies = 1..`limits.maxAdGroupCopies`, one value for the whole order. The campaign block is fixed
 *   (no campaign templates yet): campaign name on TikTok = order name.
 * Step 3 · Review — order name (default `<ad group template name> · <YYYY-MM-DD>` in local time, max 100),
 *   what will be built, the target list, then **Save as draft** (no dialog) or **Create & publish** (confirm
 *   dialog with the budget cap `amount × copies × accounts`). 201 → `/orders/<id>`; 409 → back to step 1 with
 *   one toast per rejected account and a fresh targets request; 400 → the message on its field or as a form
 *   error. Both buttons are disabled while a create is in flight, so no double submit.
 *
 * A 403 on the targets request (a Payment-only admin that typed the URL) renders `la-forbidden` with the API
 * text and nothing else; no redirect (the nav item is hidden for that admin, but the API is the authority).
 * No enum label of a template field is invented here: every one comes from the templates' `/options`.
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupTemplate,
  AdGroupTemplateOptions,
  AdGroupTemplatesResponse,
  OptionItem
} from '#shared/types/ad-group-templates'
import type { AdTemplate, AdTemplateOptions, AdTemplatesResponse } from '#shared/types/ad-templates'
import { ctaSummary, ctaValuesFrom } from '~/utils/ad-cta'
import type {
  CreateOrderBody,
  CreateOrderRejectedBody,
  CreateOrderResponse,
  LaunchAccount,
  LaunchAdvertiser,
  LaunchLimits,
  LaunchTargetsResponse,
  PublishMode
} from '#shared/types/campaign-orders'

useSeoMeta({ title: 'Launch ads' })

const TEMPLATE_LIMIT = 100
const NAME_MAX = 100
/** only used before the first `/launch/targets` answer — the API's `limits` win as soon as they arrive */
const FALLBACK_MAX_COPIES = 8

const api = useApi()
const toast = useToast()

// ── step 1 · targets ─────────────────────────────────────────────────────────────────────────────────────────────────
const accounts = ref<LaunchAccount[]>([])
const limits = ref<LaunchLimits | null>(null)
const targetsPending = ref(true)
const targetsLoaded = ref(false)
const targetsError = ref<string | null>(null)
const forbidden = ref<string | null>(null)
// bumped on every request so a late response from a superseded one is dropped
let targetsSession = 0

const maxCopies = computed(() => limits.value?.maxAdGroupCopies ?? FALLBACK_MAX_COPIES)

/** account id → chosen advertiser id (one per account this round); the body keeps the table order */
const selection = ref<Record<string, string>>({})

/**
 * BUG-027 — the account ids whose advertiser the **user** chose by hand, through the row radio
 * (`pickAdvertiser`). Only those are the "explicit pick" of api-contract §3; an id that the row checkbox or
 * select-all wrote into `selection` is just the computed default of that moment (`auto`), so it follows the
 * funded filter instead of pinning an advertiser nobody asked for. Deselecting the account, clearing the
 * selection or losing the advertiser forgets the pick.
 */
const manualPicks = ref<Record<string, true>>({})

/**
 * Drop accounts that are no longer available and re-point an advertiser that stopped being selectable.
 *
 * BUG-044 — the re-point goes through `computedDefaultId()` like every other path on this page, **not** through
 * the raw `account.defaultAdvertiserId`: the contract does not promise the API default is `selectable`, and an
 * id the API will refuse must never reach `selection`, the review row or the create body (409
 * `advertiserNotSelectable` on a row the user never touched). `computedDefaultId` falls back to the first
 * selectable advertiser; an account with none keeps no selection at all.
 */
function reconcileSelection() {
  const next: Record<string, string> = {}
  const nextManual: Record<string, true> = {}
  for (const account of accounts.value) {
    if (!account.available) continue
    const picked = selection.value[account.id]
    if (!picked) continue
    const advertiser = account.advertisers.find(a => a.id === picked)
    const keep = advertiser?.selectable ? picked : computedDefaultId(account)
    if (!keep) continue
    next[account.id] = keep
    // BUG-027/BUG-044 — a pick we had to re-point is not the user's choice any more: the row goes back to
    // `auto` on the computed default (visible as the `auto` badge) and follows the funded filter again
    if (keep === picked && manualPicks.value[account.id]) nextManual[account.id] = true
  }
  selection.value = next
  manualPicks.value = nextManual
}

async function loadTargets() {
  const s = ++targetsSession
  targetsPending.value = true
  targetsError.value = null
  try {
    // retry: 0 — exactly one request per page open / Refresh
    const res = await api<LaunchTargetsResponse>('/launch/targets', { retry: 0 })
    if (s !== targetsSession) return
    accounts.value = res.accounts ?? []
    limits.value = res.limits ?? null
    targetsLoaded.value = true
    forbidden.value = null
    reconcileSelection()
  } catch (e) {
    if (s !== targetsSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    accounts.value = []
    selection.value = {}
    manualPicks.value = {}
    if ((err.response?.status ?? err.statusCode) === 403) forbidden.value = message
    else targetsError.value = message
  } finally {
    if (s === targetsSession) targetsPending.value = false
  }
}

const availableAccounts = computed(() => accounts.value.filter(a => a.available))
const unavailableAccounts = computed(() => accounts.value.filter(a => !a.available))

// ── step 1 · filters ─────────────────────────────────────────────────────────────────────────────────────────────────
const accountSearch = ref('')
const workspaceFilter = ref<string>('all')
/** FEAT-026 — "Only with balance", on at every page open, never persisted (spec A4) */
const fundedOnly = ref(true)
const unavailableOpen = ref(false)
const expanded = ref<string[]>([])

/**
 * FEAT-034 — TikTok keeps one shared cash balance per Business Center, so "funded" is a property of the
 * account (`account.hasBalance`), not of an individual advertiser any more; an account still needs ≥ 1
 * `selectable` advertiser to be launchable at all.
 */
function isFunded(account: LaunchAccount): boolean {
  return account.available && account.hasBalance && account.advertisers.some(a => a.selectable)
}

/** AS-8 — the API default when it is still selectable, else the first selectable advertiser of the account */
function computedDefaultId(account: LaunchAccount): string | null {
  const def = account.defaultAdvertiserId
  if (def && account.advertisers.find(a => a.id === def)?.selectable) return def
  return account.advertisers.find(a => a.selectable)?.id ?? null
}

const workspaceItems = computed(() => {
  const seen = new Map<string, string>()
  for (const account of accounts.value) {
    if (account.workspace?.id) seen.set(account.workspace.id, account.workspace.name ?? account.workspace.id)
  }
  return [
    { label: 'All workspaces', value: 'all' },
    ...[...seen].map(([value, label]) => ({ label, value }))
  ]
})
/** with a single workspace the filter carries no information (spec AC-13) */
const showWorkspaceFilter = computed(() => workspaceItems.value.length > 2)

/** available ∩ workspace ∩ search — the funded filter composes on top (`filteredAccounts`) */
const searchFilteredAccounts = computed(() => {
  const q = accountSearch.value.trim().toLowerCase()
  return availableAccounts.value.filter((account) => {
    if (workspaceFilter.value !== 'all' && account.workspace?.id !== workspaceFilter.value) return false
    if (!q) return true
    const haystack = [
      account.label ?? '',
      account.loginEmail,
      account.bcOrgName ?? '',
      ...account.advertisers.flatMap(a => [a.name, a.tiktokAdvertiserId])
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
})

/** available ∩ workspace ∩ search ∩ (funded when the switch is on), all client-side (spec A3) */
const filteredAccounts = computed(() => {
  if (!fundedOnly.value) return searchFilteredAccounts.value
  return searchFilteredAccounts.value.filter(isFunded)
})

/** how many of the search/workspace-filtered accounts the funded switch additionally hides */
const unfundedHiddenCount = computed(() => searchFilteredAccounts.value.filter(a => !isFunded(a)).length)

/**
 * Turning the switch on drops unfunded accounts from the selection (A6); off keeps it.
 *
 * BUG-027 — on top of the drop, every **auto** selection that survives is re-resolved to the computed default
 * under the new filter state: the whole point of the filter is not to launch on an advertiser without money, so
 * an advertiser that select-all or the row checkbox wrote in while the switch was off must not survive as if it
 * were an explicit pick. A `manualPicks` entry (a radio pick the user made) is never re-resolved, in either
 * direction, and turning the switch off changes nothing (A6 / qa harness fix H10).
 */
watch(fundedOnly, (on) => {
  if (!on) return
  const unfunded = availableAccounts.value.filter(a => !isFunded(a)).map(a => a.id)
  const next = without(selection.value, unfunded)
  for (const account of availableAccounts.value) {
    if (next[account.id] === undefined || manualPicks.value[account.id]) continue
    const def = computedDefaultId(account)
    if (def) next[account.id] = def
  }
  selection.value = next
  manualPicks.value = without(manualPicks.value, unfunded)
})

const selectedCount = computed(() => Object.keys(selection.value).length)
/** target order = the order the API served the accounts in (the API keeps the body order) */
const selectedAccounts = computed(() => availableAccounts.value.filter(a => selection.value[a.id]))
const selectedWorkspaceCount = computed(
  () => new Set(selectedAccounts.value.map(a => a.workspace?.id).filter(Boolean)).size
)

function advertiserOf(account: LaunchAccount): LaunchAdvertiser | null {
  const id = selection.value[account.id] ?? computedDefaultId(account)
  return account.advertisers.find(a => a.id === id) ?? null
}

/** the shown advertiser is still the computed default (funded-first on, API default off) — `auto` badge */
function isAutoAdvertiser(account: LaunchAccount): boolean {
  const def = computedDefaultId(account)
  const id = selection.value[account.id] ?? def
  return !!id && id === def
}

function isSelected(account: LaunchAccount): boolean {
  return selection.value[account.id] !== undefined
}

function setSelected(account: LaunchAccount, on: boolean) {
  if (!on) {
    selection.value = without(selection.value, [account.id])
    manualPicks.value = without(manualPicks.value, [account.id])
    return
  }
  const id = selection.value[account.id]
    ?? computedDefaultId(account)
    ?? account.advertisers.find(a => a.selectable)?.id
  if (!id) return
  selection.value = { ...selection.value, [account.id]: id }
}

/** a selection / manual-pick map without the given account ids (no dynamic `delete`) */
function without<T>(source: Record<string, T>, ids: string[]): Record<string, T> {
  const drop = new Set(ids)
  return Object.fromEntries(Object.entries(source).filter(([id]) => !drop.has(id)))
}

/** picking an advertiser selects its account too (human decision 1) — and marks it as a manual pick (BUG-027) */
function pickAdvertiser(account: LaunchAccount, advertiser: LaunchAdvertiser) {
  if (!advertiser.selectable) return
  selection.value = { ...selection.value, [account.id]: advertiser.id }
  manualPicks.value = { ...manualPicks.value, [account.id]: true }
}

/** header checkbox state over the **visible** rows only (api-contract §3) */
const visibleSelectedCount = computed(() => filteredAccounts.value.filter(isSelected).length)
const selectAllState = computed<boolean | 'indeterminate'>(() => {
  const total = filteredAccounts.value.length
  const selected = visibleSelectedCount.value
  if (total === 0 || selected === 0) return false
  return selected === total ? true : 'indeterminate'
})

/** click when not all visible selected → select every visible row; click when all selected → deselect them */
function toggleSelectAllVisible() {
  const rows = filteredAccounts.value
  if (rows.length === 0) return
  if (visibleSelectedCount.value === rows.length) {
    selection.value = without(selection.value, rows.map(a => a.id))
    manualPicks.value = without(manualPicks.value, rows.map(a => a.id))
    return
  }
  const picked: Record<string, string> = { ...selection.value }
  for (const account of rows) {
    const id = picked[account.id] ?? computedDefaultId(account) ?? account.advertisers.find(a => a.selectable)?.id
    if (id) picked[account.id] = id
  }
  selection.value = picked
}

function clearSelection() {
  selection.value = {}
  manualPicks.value = {}
}

function toggleExpanded(id: string) {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter(x => x !== id)
    : [...expanded.value, id]
}

/** also turns the funded filter off (spec AC-9) — the search no-match state means it is time to see everything */
function clearAccountSearch() {
  accountSearch.value = ''
  fundedOnly.value = false
}

function showAllAccounts() {
  fundedOnly.value = false
}

/** FEAT-034 — `<balanceAmount> <balanceCurrency>` of the account, printed as stored, or `—` (api-contract §4) */
function balanceCell(account: LaunchAccount | null): string {
  if (!account?.balanceAmount) return '—'
  return account.balanceCurrency ? `${account.balanceAmount} ${account.balanceCurrency}` : account.balanceAmount
}

/** `title` of `la-acc-balance` — when the account's balance was last read, or that it never was */
function balanceAtTitle(account: LaunchAccount): string {
  return account.balanceAt ? `อัปเดต ${formatDateTime(account.balanceAt)}` : 'ยังไม่เคยอ่านยอด'
}

// ── step 2 · templates (one request set per page lifetime) ────────────────────────────────────────────────────────────
const agtItems = ref<AdGroupTemplate[]>([])
const agtTotal = ref(0)
const agtOptions = ref<AdGroupTemplateOptions | null>(null)
const adtItems = ref<AdTemplate[]>([])
const adtTotal = ref(0)
const adtOptions = ref<AdTemplateOptions | null>(null)
const templatesPending = ref(false)
const templatesError = ref<string | null>(null)
const templateFieldError = ref<string | null>(null)
let templatesRequested = false

async function loadTemplates() {
  templatesPending.value = true
  templatesError.value = null
  try {
    // retry: 0 — four requests, once per page lifetime (a failure allows one retry)
    const [groups, groupOptions, ads, adOptions] = await Promise.all([
      api<AdGroupTemplatesResponse>('/ad-group-templates', { retry: 0, query: { page: 1, limit: TEMPLATE_LIMIT } }),
      api<AdGroupTemplateOptions>('/ad-group-templates/options', { retry: 0 }),
      api<AdTemplatesResponse>('/ad-templates', { retry: 0, query: { page: 1, limit: TEMPLATE_LIMIT } }),
      api<AdTemplateOptions>('/ad-templates/options', { retry: 0 })
    ])
    agtItems.value = groups.templates ?? []
    agtTotal.value = groups.total ?? agtItems.value.length
    agtOptions.value = groupOptions
    adtItems.value = ads.templates ?? []
    adtTotal.value = ads.total ?? adtItems.value.length
    adtOptions.value = adOptions
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    // allow exactly one more attempt through the Retry button
    templatesRequested = false
    templatesError.value = err.data?.error ?? err.message ?? 'Unexpected error'
  } finally {
    templatesPending.value = false
  }
}

function ensureTemplates() {
  if (templatesRequested) return
  templatesRequested = true
  void loadTemplates()
}

function retryTemplates() {
  ensureTemplates()
}

const adGroupTemplateId = ref<string | null>(null)
const adTemplateId = ref<string | null>(null)
const copies = ref(1)
const agtSearch = ref('')
const adtSearch = ref('')

const copiesItems = computed(() =>
  Array.from({ length: maxCopies.value }, (_, i) => ({ label: String(i + 1), value: i + 1 }))
)

// the API's ceiling may be lower than the fallback — never keep a value it would refuse
watch(maxCopies, (max) => {
  if (copies.value > max) copies.value = max
})

const adGroupTemplate = computed(() => agtItems.value.find(t => t.id === adGroupTemplateId.value) ?? null)
const adTemplate = computed(() => adtItems.value.find(t => t.id === adTemplateId.value) ?? null)

/** a client-side filter inside the section, needed only when the API has more rows than the one page we read */
const agtFiltered = computed(() => filterByName(agtItems.value, agtSearch.value))
const adtFiltered = computed(() => filterByName(adtItems.value, adtSearch.value))
const showAgtSearch = computed(() => agtTotal.value > agtItems.value.length || agtItems.value.length > 8)
const showAdtSearch = computed(() => adtTotal.value > adtItems.value.length || adtItems.value.length > 8)

function filterByName<T extends { name: string, description: string | null }>(items: T[], term: string): T[] {
  const q = term.trim().toLowerCase()
  if (!q) return items
  return items.filter(t => `${t.name} ${t.description ?? ''}`.toLowerCase().includes(q))
}

/** the label of an option value; falls back to the raw value so an unknown value still renders */
function labelOf(list: OptionItem[] | undefined, value: string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return list?.find(item => item.value === value)?.label ?? value
}

function isAgtStale(template: AdGroupTemplate): boolean {
  const current = agtOptions.value?.catalogVersion
  // without `/options` there is nothing to compare against — never cry wolf
  if (!current) return false
  return template.catalogVersion !== current
}

function isAdtStale(template: AdTemplate): boolean {
  const current = adtOptions.value?.catalogVersion
  if (!current) return false
  return template.catalogVersion !== current
}

function selectAdGroupTemplate(template: AdGroupTemplate) {
  if (isAgtStale(template)) return
  adGroupTemplateId.value = template.id
  templateFieldError.value = null
}

function selectAdTemplate(template: AdTemplate) {
  if (isAdtStale(template)) return
  adTemplateId.value = template.id
  templateFieldError.value = null
}

/** `<amount 2 decimals> <currency label> / <budgetType label>` — labels from `/options` */
function budgetCell(template: AdGroupTemplate): string {
  const budget = template.config?.budget
  const amount = Number.isFinite(budget?.amount) ? budget.amount.toFixed(2) : '—'
  return `${amount} ${labelOf(agtOptions.value?.currency, budget?.currency)} / ${labelOf(agtOptions.value?.budgetType, budget?.type)}`
}

/** `<scheduleMode label>`, plus ` · <start> → <end>` for a date range */
function scheduleCell(template: AdGroupTemplate): string {
  const schedule = template.config?.schedule
  const mode = labelOf(agtOptions.value?.scheduleMode, schedule?.mode)
  if (schedule?.mode !== 'dateRange') return mode
  const start = schedule.startTime === 'now'
    ? labelOf(agtOptions.value?.startTimeMode, 'now')
    : shortDateTime(String(schedule.startTime))
  return `${mode} · ${start} → ${shortDateTime(schedule.endTime)}`
}

/** locations · age groups · gender, all three with the labels of `/options` */
function targetingCell(template: AdGroupTemplate): string {
  const config = template.config
  const locations = (config?.locations ?? []).map(v => labelOf(agtOptions.value?.locations, v)).join(', ') || '—'
  const ages = (config?.ageGroups ?? []).length === 0
    ? (agtOptions.value?.ageGroupsUnlimitedLabel ?? '—')
    : config.ageGroups.map(v => labelOf(agtOptions.value?.ageGroups, v)).join(', ')
  return `${locations} · ${ages} · ${labelOf(agtOptions.value?.gender, config?.gender)}`
}

function postCell(template: AdTemplate): string {
  const post = template.config?.identity?.post
  if (post?.selection === 'authCode') return 'code' in post && post.code ? post.code : ''
  return post?.selection === 'named' ? post.text : 'First authorized post'
}

function pageCell(template: AdTemplate): string {
  const page = template.config?.destination?.page
  return page?.selection === 'named' ? page.name : 'First in library'
}

function ctaCell(template: AdTemplate): string {
  const values = ctaValuesFrom(template.config?.cta, adtOptions.value?.systemDefault?.cta?.values ?? [])
  return ctaSummary(values, adtOptions.value?.ctaValue)
}

function catalogCell(version: string | null): string {
  if (!version) return '–'
  return version.split('/')[1] ?? version
}

// ── step 3 · order ───────────────────────────────────────────────────────────────────────────────────────────────────
const orderName = ref('')
const nameTouched = ref(false)
const nameServerError = ref<string | null>(null)
const formError = ref<string | null>(null)
const submitting = ref(false)
const publishOpen = ref(false)

/** local calendar date as `YYYY-MM-DD` (never UTC, never locale-dependent) */
function localDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const defaultOrderName = computed(() => {
  const template = adGroupTemplate.value
  return template ? `${template.name} · ${localDate()}` : ''
})

// the default follows the ad group template until the user types their own name
watch(defaultOrderName, (value) => {
  if (!nameTouched.value) orderName.value = value
}, { immediate: true })

function onNameInput() {
  nameTouched.value = true
  nameServerError.value = null
}

const trimmedName = computed(() => orderName.value.trim())
const nameError = computed(() => {
  if (nameServerError.value) return nameServerError.value
  if (trimmedName.value === '') return 'Name is required'
  if (trimmedName.value.length > NAME_MAX) return `Name is longer than ${NAME_MAX} characters`
  return null
})

const totalAdGroups = computed(() => selectedCount.value * copies.value)
const budget = computed(() => adGroupTemplate.value?.config?.budget ?? null)
const budgetTypeLabel = computed(() => labelOf(agtOptions.value?.budgetType, budget.value?.type))

// ── stepper ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const step = ref(1)
const canLeaveStep1 = computed(() => selectedCount.value > 0)
const canLeaveStep2 = computed(() => !!adGroupTemplateId.value && !!adTemplateId.value)
const canSubmit = computed(() => canLeaveStep1.value && canLeaveStep2.value && nameError.value === null)

const steps = [
  { no: 1, title: 'Accounts', description: 'Who to launch for' },
  { no: 2, title: 'Templates', description: 'What to build' },
  { no: 3, title: 'Review', description: 'Name and confirm' }
]

function stepState(no: number): 'active' | 'done' | 'todo' {
  if (no === step.value) return 'active'
  return no < step.value ? 'done' : 'todo'
}

function canReach(no: number): boolean {
  if (no <= 1) return true
  if (no === 2) return canLeaveStep1.value
  return canLeaveStep1.value && canLeaveStep2.value
}

function goStep(no: number) {
  if (!canReach(no)) return
  step.value = no
  if (no >= 2) ensureTemplates()
}

function next() {
  goStep(Math.min(step.value + 1, 3))
}

function back() {
  step.value = Math.max(step.value - 1, 1)
}

// ── create ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function body(publishMode: PublishMode): CreateOrderBody {
  return {
    name: trimmedName.value,
    adGroupTemplateId: adGroupTemplateId.value as string,
    adTemplateId: adTemplateId.value as string,
    adGroupCopies: copies.value,
    publishMode,
    targets: selectedAccounts.value.map(account => ({
      tiktokAccountId: account.id,
      advertiserId: selection.value[account.id] as string
    }))
  }
}

/** 409 — the readiness changed between `/launch/targets` and the POST (spec AC-16) */
function onRejected(rejected: CreateOrderRejectedBody['rejected']) {
  for (const entry of rejected) {
    const account = accounts.value.find(a => a.id === entry.tiktokAccountId)
    toast.add({
      title: account?.label ?? account?.loginEmail ?? 'Account not ready',
      description: reasonsText(entry.reasons),
      color: 'warning',
      icon: 'i-lucide-triangle-alert'
    })
  }
  const rejectedIds = rejected.map(entry => entry.tiktokAccountId)
  selection.value = without(selection.value, rejectedIds)
  manualPicks.value = without(manualPicks.value, rejectedIds)
  step.value = 1
  // the readiness is stale — read it again
  void loadTargets()
}

/** 400 — put every zod issue where the user can see it */
function onValidationIssues(issues: NonNullable<ApiErrorBody['issues']>) {
  const nameIssue = issues.find(i => i.path === 'name')
  const templateIssue = issues.find(i => i.path === 'adGroupTemplateId' || i.path === 'adTemplateId')
  if (nameIssue) {
    nameServerError.value = nameIssue.message
    step.value = 3
  }
  if (templateIssue) {
    templateFieldError.value = templateIssue.message
    step.value = 2
    ensureTemplates()
  }
  const rest = issues.filter(i => i !== nameIssue && i !== templateIssue)
  if (rest.length > 0 || (!nameIssue && !templateIssue)) {
    formError.value = issues.map(i => `${i.path}: ${i.message}`).join(' · ')
  }
}

async function create(publishMode: PublishMode) {
  if (submitting.value || !canSubmit.value) return
  submitting.value = true
  formError.value = null
  nameServerError.value = null
  templateFieldError.value = null
  try {
    // retry: 0 — exactly one POST per click
    const res = await api<CreateOrderResponse>('/campaign-orders', {
      method: 'POST',
      retry: 0,
      body: body(publishMode)
    })
    publishOpen.value = false
    toast.add({
      title: publishMode === 'publish' ? 'Order created — builds queued to publish' : 'Draft order created',
      description: res.order.name,
      color: 'success',
      icon: 'i-lucide-rocket'
    })
    await navigateTo(`/orders/${res.order.id}`)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody & CreateOrderRejectedBody>>
    const status = err.response?.status ?? err.statusCode
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    publishOpen.value = false
    const rejected = err.data?.rejected
    if (status === 409 && Array.isArray(rejected)) {
      formError.value = message
      onRejected(rejected)
    } else if (status === 400 && err.data?.issues?.length) {
      onValidationIssues(err.data.issues)
    } else {
      formError.value = message
      toast.add({ title: 'Could not create the order', description: message, color: 'error' })
    }
  } finally {
    submitting.value = false
  }
}

function saveDraft() {
  void create('draft')
}

function askPublish() {
  if (!canSubmit.value) return
  publishOpen.value = true
}

function confirmPublish() {
  void create('publish')
}

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const now = useNow({ interval: 30_000 })
function timeAgo(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}

/** deterministic local short datetime (`YYYY-MM-DD HH:mm`) */
function shortDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const ADVERTISER_BADGE: Record<string, { label: string, color: 'success' | 'error' | 'neutral' }> = {
  active: { label: 'Active', color: 'success' },
  suspended: { label: 'Suspended', color: 'error' },
  unknown: { label: 'Unknown', color: 'neutral' }
}

function advertiserBadge(advertiser: LaunchAdvertiser): { label: string, color: 'success' | 'error' | 'neutral' } {
  if (advertiser.missingSince) return { label: 'Missing', color: 'error' }
  return ADVERTISER_BADGE[advertiser.status] ?? { label: advertiser.status, color: 'neutral' }
}

function accountName(account: LaunchAccount): string {
  return account.label ?? account.loginEmail
}

/** the row's email line is dropped when the label already is the email (label null) */
function accountEmail(account: LaunchAccount): string {
  return account.label ? account.loginEmail : ''
}

function advertiserCountLabel(account: LaunchAccount): string {
  const n = account.advertisers.length
  return `${n} advertiser${n === 1 ? '' : 's'}`
}

const hasAccountSearch = computed(() => accountSearch.value.trim() !== '' || workspaceFilter.value !== 'all')
const showAccountsEmpty = computed(() =>
  targetsLoaded.value && !targetsError.value && !forbidden.value && availableAccounts.value.length === 0
)
/** switch on, no search/workspace filter, every available account unfunded (spec AC-9) */
const showAccountsNoFunded = computed(() =>
  !showAccountsEmpty.value && fundedOnly.value && !hasAccountSearch.value && filteredAccounts.value.length === 0
)
const showAccountsNoMatch = computed(() =>
  !showAccountsEmpty.value && !showAccountsNoFunded.value && filteredAccounts.value.length === 0 && hasAccountSearch.value
)

onMounted(() => {
  void loadTargets()
})

onUnmounted(() => {
  targetsSession++
})
</script>

<template>
  <UDashboardPanel id="launch-ads">
    <template #header>
      <UDashboardNavbar title="Launch ads">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="targetsPending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="la-refresh"
            @click="loadTargets()"
          />
          <UButton
            label="Orders"
            aria-label="Orders"
            icon="i-lucide-list-checks"
            color="neutral"
            variant="subtle"
            to="/orders"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="la-orders"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="la-page"
        :data-step="step"
        :data-pending="targetsPending ? 'true' : 'false'"
        :data-funded="fundedOnly ? 'true' : 'false'"
        class="flex flex-1 flex-col gap-4"
      >
        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="You cannot launch ads"
          :description="forbidden"
          data-testid="la-forbidden"
        />

        <template v-else>
          <!-- stepper: plain markup so every item carries its own testid and state -->
          <ol class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <li
              v-for="item in steps"
              :key="item.no"
              :data-testid="`la-step-${item.no}`"
              :data-state="stepState(item.no)"
            >
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-lg border border-default px-3 py-2 text-left
                  disabled:opacity-60"
                :class="stepState(item.no) === 'active' ? 'bg-elevated/70' : 'bg-default'"
                :disabled="!canReach(item.no)"
                @click="goStep(item.no)"
              >
                <span
                  class="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  :class="stepState(item.no) === 'todo' ? 'bg-elevated text-muted' : 'bg-primary text-inverted'"
                >
                  <UIcon v-if="stepState(item.no) === 'done'" name="i-lucide-check" class="size-4" />
                  <template v-else>{{ item.no }}</template>
                </span>
                <span class="flex min-w-0 flex-col">
                  <span class="truncate text-sm font-medium text-highlighted">{{ item.title }}</span>
                  <span class="truncate text-xs text-muted">{{ item.description }}</span>
                </span>
              </button>
            </li>
          </ol>

          <UAlert
            v-if="targetsError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Could not load the launch targets"
            :description="targetsError"
            data-testid="la-error"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="targetsPending"
                data-testid="la-retry"
                @click="loadTargets()"
              />
            </template>
          </UAlert>

          <div class="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <!-- ── step content ─────────────────────────────────────────────────────────────────────── -->
            <div class="flex min-w-0 flex-col gap-4 lg:col-span-2">
              <!-- step 1 · accounts -->
              <div v-if="step === 1" class="flex flex-col gap-3">
                <div class="flex flex-wrap items-center gap-1.5">
                  <UInput
                    v-model="accountSearch"
                    class="w-full sm:max-w-xs"
                    icon="i-lucide-search"
                    placeholder="Search account or advertiser"
                    data-testid="la-acc-search"
                  />
                  <USelect
                    v-if="showWorkspaceFilter"
                    v-model="workspaceFilter"
                    :items="workspaceItems"
                    :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
                    class="min-w-36"
                    aria-label="Workspace"
                    data-testid="la-acc-ws"
                  />
                  <USwitch
                    v-model="fundedOnly"
                    label="Only with balance"
                    data-testid="la-acc-funded"
                  />
                  <UButton
                    v-if="selectedCount > 0"
                    label="Clear"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    data-testid="la-acc-clear"
                    @click="clearSelection"
                  />
                  <UBadge
                    color="primary"
                    variant="subtle"
                    class="ml-auto whitespace-nowrap"
                    data-testid="la-acc-count"
                  >
                    {{ selectedCount }} selected
                  </UBadge>
                </div>

                <UEmpty
                  v-if="showAccountsEmpty"
                  icon="i-lucide-user-x"
                  title="No account is ready to launch"
                  :description="`${unavailableAccounts.length} account(s) are unavailable right now`"
                  data-testid="la-acc-empty"
                >
                  <template #actions>
                    <UButton
                      label="Go to TikTok accounts"
                      icon="i-lucide-user-round"
                      color="neutral"
                      variant="outline"
                      to="/tiktok-accounts"
                      data-testid="la-acc-empty-link"
                    />
                  </template>
                </UEmpty>

                <UEmpty
                  v-else-if="showAccountsNoFunded"
                  icon="i-lucide-wallet"
                  title="No account has a balance"
                  :description="`Turn the filter off to see ${unfundedHiddenCount} available account(s)`"
                  data-testid="la-acc-nofunded"
                >
                  <template #actions>
                    <UButton
                      label="Show all"
                      icon="i-lucide-eye"
                      color="neutral"
                      variant="outline"
                      data-testid="la-acc-show-all"
                      @click="showAllAccounts"
                    />
                  </template>
                </UEmpty>

                <UEmpty
                  v-else-if="showAccountsNoMatch"
                  icon="i-lucide-search-x"
                  title="No account matches your filters"
                  data-testid="la-acc-nomatch"
                >
                  <template #actions>
                    <UButton
                      label="Clear search"
                      icon="i-lucide-x"
                      color="neutral"
                      variant="outline"
                      data-testid="la-acc-clear-search"
                      @click="clearAccountSearch"
                    />
                  </template>
                </UEmpty>

                <div v-else class="overflow-x-auto" data-testid="la-acc-table">
                  <table class="w-full border-separate border-spacing-0 text-sm">
                    <thead>
                      <tr class="bg-elevated/50">
                        <th class="w-10 rounded-l-lg border-y border-l border-default px-3 py-2">
                          <UCheckbox
                            :model-value="selectAllState"
                            aria-label="Select all visible accounts"
                            :disabled="filteredAccounts.length === 0"
                            data-testid="la-acc-select-all"
                            @update:model-value="toggleSelectAllVisible"
                          />
                        </th>
                        <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                          Account
                        </th>
                        <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                          Workspace
                        </th>
                        <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                          BC
                        </th>
                        <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                          Advertiser
                        </th>
                        <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                          <span class="sr-only">Advertisers</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody :class="targetsPending ? 'opacity-60' : ''">
                      <tr v-if="targetsPending && accounts.length === 0" data-testid="la-acc-loading">
                        <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="6">
                          Loading accounts…
                        </td>
                      </tr>
                      <template v-for="account in filteredAccounts" :key="account.id">
                        <tr
                          :data-id="account.id"
                          :data-selected="isSelected(account) ? 'true' : 'false'"
                          :data-funded="isFunded(account) ? 'true' : 'false'"
                          data-slot="tr"
                          data-testid="la-acc-row"
                        >
                          <td class="border-b border-default px-3 py-2">
                            <UCheckbox
                              :model-value="isSelected(account)"
                              :aria-label="`Select ${accountName(account)}`"
                              data-testid="la-acc-check"
                              @update:model-value="(v: boolean | 'indeterminate') => setSelected(account, v === true)"
                            />
                          </td>
                          <td class="border-b border-default px-3 py-2">
                            <div class="flex flex-col">
                              <span class="font-medium text-highlighted" data-testid="la-acc-name">{{ accountName(account) }}</span>
                              <span v-if="accountEmail(account)" class="text-xs text-muted">{{ accountEmail(account) }}</span>
                            </div>
                          </td>
                          <td class="border-b border-default px-3 py-2">
                            <UBadge
                              color="neutral"
                              variant="outline"
                              class="whitespace-nowrap"
                              data-testid="la-acc-workspace"
                            >
                              {{ account.workspace?.name ?? '—' }}
                            </UBadge>
                          </td>
                          <td class="border-b border-default px-3 py-2">
                            <span class="text-muted" data-testid="la-acc-bc">{{ account.bcOrgName ?? '—' }}</span>
                          </td>
                          <td class="border-b border-default px-3 py-2">
                            <div class="flex min-w-0 flex-col" data-testid="la-acc-adv">
                              <span class="truncate text-highlighted">{{ advertiserOf(account)?.name ?? '—' }}</span>
                              <span class="flex items-center gap-1 text-xs text-muted">
                                <span>{{ advertiserOf(account)?.tiktokAdvertiserId ?? '—' }}</span>
                                <UBadge
                                  v-if="isAutoAdvertiser(account)"
                                  color="neutral"
                                  variant="subtle"
                                  size="sm"
                                  data-testid="la-acc-auto"
                                >
                                  auto
                                </UBadge>
                              </span>
                              <span
                                class="text-xs text-muted tabular-nums"
                                data-testid="la-acc-balance"
                                :title="balanceAtTitle(account)"
                              >
                                {{ balanceCell(account) }}
                              </span>
                            </div>
                          </td>
                          <td class="border-b border-default px-3 py-2 text-right">
                            <UButton
                              :label="advertiserCountLabel(account)"
                              :icon="expanded.includes(account.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                              color="neutral"
                              variant="ghost"
                              size="xs"
                              class="whitespace-nowrap"
                              data-testid="la-acc-expand"
                              @click="toggleExpanded(account.id)"
                            />
                          </td>
                        </tr>
                        <tr v-if="expanded.includes(account.id)" :data-id="account.id" data-testid="la-acc-expanded">
                          <td class="border-b border-default bg-elevated/30 px-3 py-2" colspan="6">
                            <ul class="flex flex-col gap-1">
                              <li
                                v-for="advertiser in account.advertisers"
                                :key="advertiser.id"
                                :data-id="advertiser.id"
                                :data-selectable="advertiser.selectable ? 'true' : 'false'"
                                data-testid="la-adv-option"
                                class="flex flex-wrap items-center gap-2 rounded-md px-2 py-1"
                              >
                                <input
                                  type="radio"
                                  class="size-4"
                                  :name="`advertiser-${account.id}`"
                                  :checked="selection[account.id] === advertiser.id"
                                  :disabled="!advertiser.selectable"
                                  :aria-label="advertiser.name"
                                  data-testid="la-adv-radio"
                                  @change="pickAdvertiser(account, advertiser)"
                                >
                                <span class="min-w-0 truncate text-highlighted">{{ advertiser.name }}</span>
                                <span class="text-xs text-muted">{{ advertiser.tiktokAdvertiserId }}</span>
                                <UBadge
                                  :color="advertiserBadge(advertiser).color"
                                  variant="subtle"
                                  size="sm"
                                  class="whitespace-nowrap"
                                  data-testid="la-adv-badge"
                                >
                                  {{ advertiserBadge(advertiser).label }}
                                </UBadge>
                              </li>
                            </ul>
                          </td>
                        </tr>
                      </template>
                    </tbody>
                  </table>
                </div>

                <p
                  v-if="fundedOnly && unfundedHiddenCount > 0"
                  class="text-xs text-muted"
                  data-testid="la-acc-unfunded-hint"
                >
                  {{ unfundedHiddenCount }} account(s) without balance hidden
                  <UButton
                    label="Show all"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    data-testid="la-acc-show-all"
                    @click="showAllAccounts"
                  />
                </p>

                <!-- unavailable strip: collapsed by default -->
                <div v-if="unavailableAccounts.length > 0" class="flex flex-col gap-2 border-t border-default pt-3">
                  <UButton
                    :label="`Unavailable (${unavailableAccounts.length})`"
                    :icon="unavailableOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    class="self-start"
                    data-testid="la-unavail-toggle"
                    @click="unavailableOpen = !unavailableOpen"
                  />
                  <ul v-if="unavailableOpen" class="flex flex-col gap-2">
                    <li
                      v-for="account in unavailableAccounts"
                      :key="account.id"
                      :data-id="account.id"
                      data-testid="la-unavail-row"
                      class="flex flex-wrap items-center gap-2 rounded-lg border border-default px-3 py-2 text-sm"
                    >
                      <span class="font-medium text-highlighted">{{ accountName(account) }}</span>
                      <span v-if="accountEmail(account)" class="text-xs text-muted">{{ accountEmail(account) }}</span>
                      <UBadge color="neutral" variant="outline" size="sm">
                        {{ account.workspace?.name ?? '—' }}
                      </UBadge>
                      <span
                        v-for="reason in account.unavailableReasons"
                        :key="reason"
                        :data-reason="reason"
                        data-testid="la-unavail-reason"
                        class="text-xs text-warning"
                      >{{ reasonText(reason) }}</span>
                      <UButton
                        label="TikTok accounts"
                        icon="i-lucide-external-link"
                        color="neutral"
                        variant="link"
                        size="xs"
                        to="/tiktok-accounts"
                        class="ml-auto"
                      />
                    </li>
                  </ul>
                </div>
              </div>

              <!-- step 2 · templates -->
              <div v-else-if="step === 2" class="flex flex-col gap-4">
                <div class="rounded-lg border border-default p-3" data-testid="la-campaign-fixed">
                  <p class="text-sm font-semibold text-highlighted">
                    Campaign · fixed
                  </p>
                  <dl class="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    <dt class="text-muted">
                      Objective
                    </dt>
                    <dd class="text-highlighted" data-testid="la-campaign-objective">
                      Sales cashback
                    </dd>
                    <dt class="text-muted">
                      Destination
                    </dt>
                    <dd class="text-highlighted" data-testid="la-campaign-destination">
                      Website conversions
                    </dd>
                    <dt class="text-muted">
                      Campaign name
                    </dt>
                    <dd class="text-highlighted">
                      = order name
                    </dd>
                  </dl>
                </div>

                <UAlert
                  v-if="templatesError"
                  color="error"
                  variant="subtle"
                  icon="i-lucide-triangle-alert"
                  title="Could not load the templates"
                  :description="templatesError"
                  data-testid="la-templates-error"
                >
                  <template #actions>
                    <UButton
                      label="Retry"
                      icon="i-lucide-refresh-cw"
                      color="error"
                      size="xs"
                      :loading="templatesPending"
                      data-testid="la-templates-retry"
                      @click="retryTemplates"
                    />
                  </template>
                </UAlert>

                <UAlert
                  v-if="templateFieldError"
                  color="warning"
                  variant="subtle"
                  icon="i-lucide-triangle-alert"
                  title="Pick another template"
                  :description="templateFieldError"
                  data-testid="la-template-field-error"
                />

                <p v-if="templatesPending" class="text-sm text-muted" data-testid="la-templates-loading">
                  Loading templates…
                </p>

                <!-- ad group template -->
                <section class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-sm font-semibold text-highlighted">
                      Ad group template
                    </h2>
                    <UInput
                      v-if="showAgtSearch"
                      v-model="agtSearch"
                      icon="i-lucide-search"
                      size="sm"
                      placeholder="Filter templates"
                      data-testid="la-agt-search"
                    />
                  </div>
                  <p v-if="!templatesPending && agtItems.length === 0" class="text-sm text-muted" data-testid="la-agt-empty">
                    No ad group template yet — create one under Ad group templates first.
                  </p>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      v-for="template in agtFiltered"
                      :key="template.id"
                      type="button"
                      :data-id="template.id"
                      :data-selected="template.id === adGroupTemplateId ? 'true' : 'false'"
                      :data-stale="isAgtStale(template) ? 'true' : 'false'"
                      :disabled="isAgtStale(template)"
                      data-testid="la-agt-card"
                      class="flex flex-col gap-1 rounded-lg border p-3 text-left disabled:opacity-60"
                      :class="template.id === adGroupTemplateId
                        ? 'border-primary bg-primary/10'
                        : 'border-default bg-default'"
                      @click="selectAdGroupTemplate(template)"
                    >
                      <span class="flex items-center gap-2">
                        <span class="min-w-0 truncate font-medium text-highlighted">{{ template.name }}</span>
                        <UBadge
                          v-if="isAgtStale(template)"
                          color="warning"
                          variant="subtle"
                          size="sm"
                          class="whitespace-nowrap"
                        >
                          Older catalog
                        </UBadge>
                      </span>
                      <span class="text-xs text-muted">{{ budgetCell(template) }}</span>
                      <span class="text-xs text-muted">{{ scheduleCell(template) }}</span>
                      <span class="line-clamp-2 text-xs text-muted">{{ targetingCell(template) }}</span>
                      <span class="text-xs text-dimmed">
                        catalog {{ catalogCell(template.catalogVersion) }} · updated {{ timeAgo(template.updatedAt) }}
                      </span>
                      <span v-if="isAgtStale(template)" class="text-xs text-warning" data-testid="la-card-stale">
                        Built from an older catalog — open it in Ad group templates and save it again
                      </span>
                    </button>
                  </div>
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="text-sm text-muted">Ad group copies</span>
                    <USelect
                      v-model="copies"
                      :items="copiesItems"
                      :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
                      class="w-24"
                      aria-label="Ad group copies"
                      data-testid="la-copies"
                    />
                    <span class="text-xs text-muted">
                      Ad groups per campaign — same settings, same budget each
                    </span>
                  </div>
                </section>

                <!-- ad template -->
                <section class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-center justify-between gap-2">
                    <h2 class="text-sm font-semibold text-highlighted">
                      Ad template
                    </h2>
                    <UInput
                      v-if="showAdtSearch"
                      v-model="adtSearch"
                      icon="i-lucide-search"
                      size="sm"
                      placeholder="Filter templates"
                      data-testid="la-adt-search"
                    />
                  </div>
                  <p v-if="!templatesPending && adtItems.length === 0" class="text-sm text-muted" data-testid="la-adt-empty">
                    No ad template yet — create one under Ad templates first.
                  </p>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      v-for="template in adtFiltered"
                      :key="template.id"
                      type="button"
                      :data-id="template.id"
                      :data-selected="template.id === adTemplateId ? 'true' : 'false'"
                      :data-stale="isAdtStale(template) ? 'true' : 'false'"
                      :disabled="isAdtStale(template)"
                      data-testid="la-adt-card"
                      class="flex flex-col gap-1 rounded-lg border p-3 text-left disabled:opacity-60"
                      :class="template.id === adTemplateId
                        ? 'border-primary bg-primary/10'
                        : 'border-default bg-default'"
                      @click="selectAdTemplate(template)"
                    >
                      <span class="flex items-center gap-2">
                        <span class="min-w-0 truncate font-medium text-highlighted">{{ template.name }}</span>
                        <UBadge
                          v-if="isAdtStale(template)"
                          color="warning"
                          variant="subtle"
                          size="sm"
                          class="whitespace-nowrap"
                        >
                          Older catalog
                        </UBadge>
                      </span>
                      <span class="break-all text-xs text-muted">{{ postCell(template) }}</span>
                      <span class="line-clamp-1 text-xs text-muted">{{ pageCell(template) }}</span>
                      <span class="line-clamp-2 text-xs text-muted" :title="ctaCell(template)">{{ ctaCell(template) }}</span>
                      <span class="text-xs text-dimmed">
                        catalog {{ catalogCell(template.catalogVersion) }} · updated {{ timeAgo(template.updatedAt) }}
                      </span>
                      <span v-if="isAdtStale(template)" class="text-xs text-warning" data-testid="la-card-stale">
                        Built from an older catalog — open it in Ad templates and save it again
                      </span>
                    </button>
                  </div>
                </section>
              </div>

              <!-- step 3 · review -->
              <div v-else class="flex flex-col gap-4">
                <UAlert
                  v-if="formError"
                  color="error"
                  variant="subtle"
                  icon="i-lucide-triangle-alert"
                  title="Could not create the order"
                  :description="formError"
                  data-testid="la-form-error"
                />

                <UFormField
                  label="Order name"
                  :error="nameError ?? undefined"
                  :hint="`max ${NAME_MAX} characters`"
                >
                  <UInput
                    v-model="orderName"
                    class="w-full sm:max-w-md"
                    :maxlength="NAME_MAX"
                    placeholder="Order name"
                    data-testid="la-order-name"
                    @update:model-value="onNameInput"
                  />
                </UFormField>

                <section class="rounded-lg border border-default p-3">
                  <h2 class="text-sm font-semibold text-highlighted">
                    What will be built
                  </h2>
                  <dl class="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                    <dt class="text-muted">
                      Campaign
                    </dt>
                    <dd class="text-highlighted" data-testid="la-review-campaign">
                      Sales cashback → Website conversions
                    </dd>
                    <dt class="text-muted">
                      Ad group template
                    </dt>
                    <dd class="text-highlighted" data-testid="la-review-agt">
                      {{ adGroupTemplate?.name ?? '—' }}
                    </dd>
                    <dt class="text-muted">
                      Budget
                    </dt>
                    <dd class="text-highlighted" data-testid="la-review-budget">
                      {{ adGroupTemplate ? budgetCell(adGroupTemplate) : '—' }}
                    </dd>
                    <dt class="text-muted">
                      Schedule
                    </dt>
                    <dd class="text-highlighted">
                      {{ adGroupTemplate ? scheduleCell(adGroupTemplate) : '—' }}
                    </dd>
                    <dt class="text-muted">
                      Ad template
                    </dt>
                    <dd class="text-highlighted" data-testid="la-review-adt">
                      {{ adTemplate?.name ?? '—' }}
                    </dd>
                    <dt class="text-muted">
                      Per advertiser
                    </dt>
                    <dd class="text-highlighted" data-testid="la-review-groups">
                      1 campaign → {{ copies }} ad group(s) → 1 ad each · {{ totalAdGroups }} ad groups in total
                    </dd>
                  </dl>
                </section>

                <section class="flex flex-col gap-2">
                  <h2 class="text-sm font-semibold text-highlighted">
                    Targets ({{ selectedCount }})
                  </h2>
                  <ul class="flex flex-col gap-1">
                    <li
                      v-for="account in selectedAccounts"
                      :key="account.id"
                      :data-id="account.id"
                      :data-advertiser-id="selection[account.id]"
                      data-testid="la-review-target"
                      class="flex flex-wrap items-center gap-2 rounded-lg border border-default px-3 py-2 text-sm"
                    >
                      <span class="font-medium text-highlighted">{{ accountName(account) }}</span>
                      <UIcon name="i-lucide-arrow-right" class="size-4 text-dimmed" />
                      <span class="text-highlighted">{{ advertiserOf(account)?.name ?? '—' }}</span>
                      <span class="text-xs text-muted">{{ advertiserOf(account)?.tiktokAdvertiserId ?? '—' }}</span>
                      <span class="text-xs text-muted tabular-nums" data-testid="la-review-balance">
                        {{ balanceCell(account) }}
                      </span>
                      <UBadge
                        color="neutral"
                        variant="outline"
                        size="sm"
                        class="ml-auto whitespace-nowrap"
                      >
                        {{ account.workspace?.name ?? '—' }}
                      </UBadge>
                    </li>
                  </ul>
                </section>
              </div>

              <!-- footer -->
              <div class="mt-auto flex flex-wrap items-center gap-2 border-t border-default pt-4">
                <UButton
                  v-if="step > 1"
                  label="Back"
                  icon="i-lucide-arrow-left"
                  color="neutral"
                  variant="outline"
                  :disabled="submitting"
                  data-testid="la-back"
                  @click="back"
                />
                <div class="grow" />
                <UButton
                  v-if="step < 3"
                  label="Continue"
                  trailing-icon="i-lucide-arrow-right"
                  color="primary"
                  :disabled="step === 1 ? !canLeaveStep1 : !canLeaveStep2"
                  data-testid="la-next"
                  @click="next"
                />
                <template v-else>
                  <UButton
                    label="Save as draft"
                    icon="i-lucide-save"
                    color="neutral"
                    variant="outline"
                    :disabled="!canSubmit || submitting"
                    :loading="submitting"
                    data-testid="la-save-draft"
                    @click="saveDraft"
                  />
                  <UButton
                    label="Create & publish"
                    icon="i-lucide-rocket"
                    color="primary"
                    :disabled="!canSubmit || submitting"
                    :loading="submitting"
                    data-testid="la-publish"
                    @click="askPublish"
                  />
                </template>
              </div>
            </div>

            <!-- ── summary ───────────────────────────────────────────────────────────────────────────── -->
            <aside
              class="flex flex-col gap-2 rounded-lg border border-default p-3 lg:sticky lg:top-4"
              data-testid="la-summary"
            >
              <h2 class="text-sm font-semibold text-highlighted">
                Summary
              </h2>
              <dl class="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                <dt class="text-muted">
                  Accounts
                </dt>
                <dd class="text-right font-medium text-highlighted" data-testid="la-summary-accounts">
                  {{ selectedCount }}
                </dd>
                <dt class="text-muted">
                  Workspaces
                </dt>
                <dd class="text-right text-highlighted">
                  {{ selectedWorkspaceCount }}
                </dd>
                <dt class="text-muted">
                  Ad group template
                </dt>
                <dd class="truncate text-right text-highlighted">
                  {{ adGroupTemplate?.name ?? '—' }}
                </dd>
                <dt class="text-muted">
                  Copies
                </dt>
                <dd class="text-right text-highlighted">
                  {{ copies }}
                </dd>
                <dt class="text-muted">
                  Ad template
                </dt>
                <dd class="truncate text-right text-highlighted">
                  {{ adTemplate?.name ?? '—' }}
                </dd>
                <dt class="text-muted">
                  Ad groups
                </dt>
                <dd class="text-right font-medium text-highlighted" data-testid="la-summary-groups">
                  {{ totalAdGroups }}
                </dd>
              </dl>
              <p class="text-xs text-muted">
                Save as draft stops each build at <span class="font-medium">ready</span>; Create &amp; publish
                publishes on TikTok as soon as the build finishes.
              </p>
            </aside>
          </div>
        </template>
      </div>

      <LaunchAdsPublishConfirmModal
        v-model:open="publishOpen"
        :accounts="selectedCount"
        :copies="copies"
        :budget="budget"
        :budget-type-label="budgetTypeLabel"
        :submitting="submitting"
        @confirm="confirmPublish"
      />
    </template>
  </UDashboardPanel>
</template>
