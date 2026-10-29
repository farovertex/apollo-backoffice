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
 *
 *   Launch status (FEAT-029 flag served by `GET /launch/targets`): every row carries the account's status badge
 *   (`la-acc-launching`: **Launching ads** with `title="since …"` while `account.launchingAds`, else
 *   **Not launching**) and the row has `data-launching`. The second switch **"Only not launching"**
 *   (`la-acc-idle`, **on** at page open like the balance switch, not persisted) hides launching accounts, composed with the other
 *   filters by AND, client-side. Turning it on drops launching accounts from `selection`/`manualPicks`; off
 *   keeps the selection. When it alone hides every remaining row, `la-acc-nolaunching` explains and
 *   `la-acc-show-all` turns both switches off (so does `la-acc-clear-search`). Launching is **not** a
 *   readiness reason: a launching account stays `available` and can be launched again when the switch is off.
 * Step 2 · Templates — the existing list endpoints (`?limit=100`) + their `/options`, requested **once per
 *   page lifetime** when the step is first opened. An **ad-template** row whose `catalogVersion` differs from
 *   the one `/options` serves is disabled with the re-save message (spec A8) — the API refuses it anyway (400).
 *   **FEAT-061** (spec AC-20): an **ad-group-template** row is disabled when the row is `kind: 'manual'`
 *   (fallback: that same catalog comparison while an older API serves no `kind`) and says `la-agt-manual`
 *   "ต้องปรับเป็น Smart+ ก่อน" — the template has to go through "ปรับเป็น Smart+" on its own page first; the
 *   API's own 400 (`issues[].path = adGroupTemplateId`) is still shown verbatim at this step. A v3 row also
 *   shows its campaign strategy (`la-agt-campaign`: CBO + amount, or the ad-group-budget label).
 *   Copies = 1..`limits.maxAdGroupCopies`, one value for the whole order. The campaign block is fixed
 *   (no campaign templates yet): campaign name on TikTok = order name.
 * Step 3 · Review — order name (default `<ad group template name> · <YYYY-MM-DD>` in local time, max 100),
 *   what will be built, the target list, then **Save as draft** (no dialog) or **Create & publish** (confirm
 *   dialog with the budget cap `amount × copies × accounts`, or `campaign budget × accounts` under CBO —
 *   TASK-theme-cbo-cap). 201 → `/orders/<id>`; 409 → back to step 1 with
 *   one toast per rejected account and a fresh targets request; 400 → the message on its field or as a form
 *   error. Both buttons are disabled while a create is in flight, so no double submit.
 *
 * **FEAT-042** (api-contract v1 §1.2 · spec AC-15): an ad-template card also shows the post the Spark code
 * points at — the 32 px cover thumbnail (only while `postInfo.cover.ok`, shared cache with the table and the
 * modal) and the status chip (`la-adt-post-status`). Picking a template whose post is `invalid`, `failed` or
 * was never checked shows the **non-blocking** warning `la-adt-post-warning`: selection and submit are
 * untouched (only the stale-catalog rule disables a card), the order may simply fail at the ad stage.
 *
 * **FEAT-062** — the page's height no longer grows with the number of templates (spec "UI behaviour"):
 * the step actions live in one `la-actions` container, the **last block of the sticky Summary aside** at `lg+`
 * and the **fixed bottom bar** below it (same DOM element, responsive classes only — no duplicated button; the
 * body carries `pb-20 lg:pb-0` so nothing hides behind the bar). Each template is one compact row
 * (`<button role="radio">`, two truncated lines + the catalog/updated meta at `sm+`) inside a `max-h-60`
 * scroll frame (`la-agt-list` / `la-adt-list`, `role="radiogroup"`); rows that cannot be launched (manual
 * ad-group templates / older-catalog ad templates) sit **after** the usable ones inside `la-agt-hidden` /
 * `la-adt-hidden`, `hidden` until `la-agt-more` / `la-adt-more` opens them — they stay in the DOM, so the
 * counts (`la-agt-count` / `la-adt-count`, computed on the **search-filtered** list) and `data-stale` keep
 * meaning the same thing. Both search inputs are always rendered, Copies moved into the ad-group section
 * header and the fixed campaign block (`la-campaign-fixed`) into the Summary, where it shows on every step.
 * Once an ad template is picked the Summary also shows `LaunchAdsAdPreview` (`la-preview`: post cover, ad
 * texts, CTA, instant-page button, add-on) — and step 3 renders the same component as `la-review-preview`
 * under "What will be built" instead (the aside drops it there). Its one-shot `GET /ad-templates/:id` after an
 * image load error comes back through `@updated` → `replaceAdTemplate()`, so the row, the Summary and the
 * Review all use the fresh URL.
 *
 * A 403 on the targets request (a Payment-only admin that typed the URL) renders `la-forbidden` with the API
 * text and nothing else; no redirect (the nav item is hidden for that admin, but the API is the authority).
 * No enum label of a template field is invented here: every one comes from the templates' `/options`.
 *
 * FEAT-063 (api-contract.md v1, spec "UI behaviour") — a favorite star (`TiktokAccountsFavoriteStar`,
 * `la-acc-fav`) right after `la-acc-name` on every `la-acc-row` and `la-unavail-row` (clickable, `stopPropagation`
 * so it never touches the row's selection), and a static `la-review-fav` after the name of a favorite
 * `la-review-target`. Same per-admin flag and the same toggle route as `/tiktok-accounts`
 * (`#shared/types/tiktok-accounts`). `favoriteById` (override map, cleared on every fresh `loadTargets`) keeps a
 * just-toggled star correct; `pinnedFilteredAccounts` / `pinnedUnavailableAccounts` render the same two lists
 * stably sorted favorites-first — `filteredAccounts` / `unavailableAccounts` themselves (and therefore
 * `defaultAdvertiserId`, select-all-visible, every counter) are untouched by the pin.
 *
 * FEAT-066 (api-contract.md v1 §2, spec "UI behaviour", human decision §0.1) — a `UCheckbox`
 * (`la-pause-after-publish`) in the Summary panel, directly above the action buttons: "ปิด campaign ทันที
 * หลังเผยแพร่" (description "ระบบจะปิดให้หลังรอบ KPI ถัดไป"), default unchecked, page state like `copies` (survives
 * step changes), always enabled. `body()` adds `pauseAfterPublish: true` only when `publishMode === 'publish'`
 * and the box is checked — omitted otherwise (A5), so Save as draft never sends it and every FEAT-016/062
 * exact-body assertion stays valid. The value is passed to `LaunchAdsPublishConfirmModal` to render its
 * `la-confirm-pause` line. No other layout of FEAT-062 changes.
 *
 * FEAT-073 (api-contract.md v1 §2, spec "UI behaviour"/"Template scope") — the step-1 `la-acc-ws` workspace
 * select now also scopes step 2: `templateWorkspaceIds` (from `useAuth()` — GOD vs Admin's `context.workspaceIds`
 * — composed with `workspaceFilter`) is sent as `workspaceIds` on the two list requests of `loadTemplates()`,
 * omitted entirely for a GOD on "All workspaces". The two `/options` requests stay a one-time fetch
 * (`optionsLoaded`, FEAT-016 AC-14); only the two lists repeat when `templateWorkspaceIdsKey` changes **after**
 * step 2 was opened at least once (a change before that causes no request). `templatesSession` drops a stale
 * answer exactly like `targetsSession` above. After every list answer a selection the new scope no longer
 * serves is cleared (A6, answer-driven, not computed from the template's own workspace). The scope line
 * `la-tpl-scope` (absent for `none`) and the three empty-state texts of `la-agt-empty` / `la-adt-empty` follow
 * `templateScopeKind`. `retryTemplates()` always re-runs with the current scope.
 *
 * FEAT-086 (spec "UI behaviour" §3, AC-22, api-contract §5/§6.1) — line `la-adgroup-guard` directly under
 * `la-pause-after-publish`: the ad group guard this order will snapshot. `laGuardMode` (`inherit` default) +
 * `laGuardRule` are page state like `pauseAfterPublish`. `la-adgroup-guard-text` (`data-mode`, `data-source`):
 * custom → the order's rule (formatted with the selection's single currency, else "สกุลของบัญชี" +
 * `la-adgroup-guard-currency-warn`), off → "ไม่ใช้กฎ…", inherit → from the selected advertisers' `adGroupGuard`
 * blocks of `GET /launch/targets` (all the same → that rule + its layer · none → "ไม่มีกฎปิด ad group" · else
 * `mixed` with the counts). `la-adgroup-guard-edit` opens `la-adgroup-guard-popover` (mode radio + RuleFields,
 * apply disabled while invalid). `body()` adds `adGroupGuard` only when publishing with a mode other than inherit;
 * the confirm modal gets the same text as `adGroupGuardText` (null when nothing would be guarded).
 * The page has no draft/publish state of its own (the mode is the button pressed), so the line is always shown and
 * says it applies to Create & publish only; Save as draft never sends the key.
 */
import { formatTimeAgo, useLocalStorage } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupTemplate,
  AdGroupTemplateKind,
  AdGroupTemplateOptions,
  AdGroupTemplatesResponse,
  OptionItem
} from '#shared/types/ad-group-templates'
import type { AdTemplate, AdTemplateOptions, AdTemplatesResponse } from '#shared/types/ad-templates'
import { ctaSummary, ctaValuesFrom } from '~/utils/ad-cta'
import type {
  CreateOrderBody,
  CreateOrderCurrencyUnknownBody,
  CreateOrderRejectedBody,
  CreateOrderResponse,
  LaunchAccount,
  LaunchAdvertiser,
  LaunchLimits,
  LaunchTargetsResponse,
  PublishMode
} from '#shared/types/campaign-orders'
import type { AdGroupGuardMode, AdGroupGuardRule, AdGroupGuardSource } from '#shared/types/ad-group-guard'
import type { AdGroupGuardRuleDraft } from '~/utils/ad-group-guard'

useSeoMeta({ title: 'Launch ads' })

const TEMPLATE_LIMIT = 100
const NAME_MAX = 100
/** only used before the first `/launch/targets` answer — the API's `limits` win as soon as they arrive */
const FALLBACK_MAX_COPIES = 8

const api = useApi()
const toast = useToast()
const auth = useAuth()

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
    const keep = advertiser && isPickable(advertiser) ? picked : computedDefaultId(account)
    if (!keep) continue
    next[account.id] = keep
    // BUG-027/BUG-044 — a pick we had to re-point is not the user's choice any more: the row goes back to
    // `auto` on the computed default (visible as the `auto` badge) and follows the funded filter again
    if (keep === picked && manualPicks.value[account.id]) nextManual[account.id] = true
  }
  selection.value = next
  manualPicks.value = nextManual
}

/**
 * Refresh button: targets as always; FEAT-079 — once step 2 has loaded the templates they are re-read too, so a
 * post that TikTok deleted meanwhile shows up (and clears a selection that points at it).
 */
function refreshAll() {
  void loadTargets()
  if (templatesRequested) void loadTemplates()
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
    // FEAT-063 — a fresh targets fetch (first load or Refresh) drops the favorite override: the next render
    // reads the server's own per-caller `favorite` again.
    favoriteById.value = new Map()
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

/**
 * FEAT-063 — the star's override map (keyed by account id, same id space as `/tiktok-accounts`): set by a
 * successful (or reverted) `FavoriteStar` toggle, cleared on every fresh targets fetch (`loadTargets` above).
 * `effectiveFavorite` is the single read everywhere a row needs the flag (`la-acc-row` / `la-unavail-row` /
 * `la-review-target` / the pin-first sort below).
 */
const favoriteById = shallowRef(new Map<string, boolean>())
function effectiveFavorite(account: LaunchAccount): boolean {
  return favoriteById.value.get(account.id) ?? account.favorite
}
function onFavoriteChange(id: string, favorite: boolean) {
  favoriteById.value = new Map(favoriteById.value).set(id, favorite)
}
/**
 * FEAT-063 (AC-7, AS-3) — favorites first, stable. Rendering-only: `defaultAdvertiserId` auto-pick,
 * select-all-visible and every counter still read `filteredAccounts` / `unavailableAccounts` themselves (order
 * does not change what those compute), so only the two template `v-for`s use these.
 */
function pinFavoritesFirst(list: LaunchAccount[]): LaunchAccount[] {
  return [...list].sort((a, b) => Number(effectiveFavorite(b)) - Number(effectiveFavorite(a)))
}

// ── step 1 · filters ─────────────────────────────────────────────────────────────────────────────────────────────────
const accountSearch = ref('')
const workspaceFilter = ref<string>('all')
/** FEAT-026 — "Only with balance", on at every page open, never persisted (spec A4) */
const fundedOnly = ref(true)
/** "Only not launching" — hides accounts whose FEAT-029 flag is on; **on** at every page open, never persisted */
const idleOnly = ref(true)
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

/**
 * FEAT-083 (spec AC-13) — an advertiser can be picked only when it is `selectable` **and** its effective currency
 * is known (`currency !== null`, api-contract v1 §3). A null-currency advertiser is never auto-picked: every path
 * below (computed default, select-all, row checkbox, funded re-resolve, reconcile) goes through this.
 */
const CURRENCY_UNKNOWN_HINT = 'กด Sync/อ่านยอดก่อน'
function isPickable(advertiser: LaunchAdvertiser): boolean {
  return advertiser.selectable && advertiser.currency !== null && advertiser.currency !== undefined
}

/** FEAT-083 — the account has at least one pickable advertiser; otherwise its checkbox is disabled */
function accountPickable(account: LaunchAccount): boolean {
  return account.advertisers.some(isPickable)
}

/** AS-8 — the API default when it is still pickable, else the first pickable advertiser of the account */
function computedDefaultId(account: LaunchAccount): string | null {
  const def = account.defaultAdvertiserId
  const defAdvertiser = def ? account.advertisers.find(a => a.id === def) : undefined
  if (defAdvertiser && isPickable(defAdvertiser)) return def
  return account.advertisers.find(isPickable)?.id ?? null
}

/** FEAT-083 — currency of the advertiser the row shows (`?` when unknown / none) */
function accountCurrency(account: LaunchAccount): string {
  return advertiserOf(account)?.currency ?? '?'
}

/**
 * FEAT-083 (spec AC-15) — step-1 currency filter `la-filter-currency`: hides the accounts whose shown advertiser
 * currency differs (unknown ones included); it never changes the selection by itself.
 */
const CURRENCY_ALL = 'all'
const FALLBACK_CURRENCIES = ['THB', 'USD']
const currencyFilter = ref<string>(CURRENCY_ALL)
const currencyFilterItems = computed(() => {
  const codes = agtOptions.value?.currency?.length
    ? agtOptions.value.currency.map(item => ({ label: item.label, value: item.value }))
    : FALLBACK_CURRENCIES.map(code => ({ label: code, value: code }))
  return [{ label: 'ทุกสกุลเงิน', value: CURRENCY_ALL }, ...codes]
})

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

/** the label `la-acc-ws` would show for `id` — also used for the FEAT-073 scope line (id as fallback) */
function workspaceLabel(id: string): string {
  return workspaceItems.value.find(item => item.value === id)?.label ?? id
}

/**
 * FEAT-073 (api-contract.md v1 §2, spec "Template scope") — scope the step-2 template lists follow, derived
 * from the caller's role and the step-1 `workspaceFilter` (the same select that already filters the accounts
 * client-side). `isGod` / `accessible` mirror the pattern of `ad-templates.vue`'s Created-by filter.
 */
const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))
const accessibleWorkspaceIds = computed<string[]>(
  () => auth.context.value?.workspaceIds ?? (auth.admin.value?.homeWorkspaceId ? [auth.admin.value.homeWorkspaceId] : [])
)

/** `string[] | undefined` sent as `workspaceIds` on the two list requests — `undefined` omits the key */
const templateWorkspaceIds = computed<string[] | undefined>(() => {
  if (workspaceFilter.value !== 'all') return [workspaceFilter.value]
  if (isGod.value) return undefined
  return accessibleWorkspaceIds.value.length > 0 ? accessibleWorkspaceIds.value : undefined
})
/** joined once so the re-fetch watcher below has a single primitive to compare */
const templateWorkspaceIdsKey = computed(() => templateWorkspaceIds.value?.join(',') ?? '')

const templateScopeKind = computed<'none' | 'one' | 'mine'>(() => {
  if (workspaceFilter.value !== 'all') return 'one'
  if (isGod.value) return 'none'
  const n = accessibleWorkspaceIds.value.length
  if (n === 0) return 'none'
  return n === 1 ? 'one' : 'mine'
})

/** `la-tpl-scope` text — `null` hides the element (`none`) */
const templateScopeLine = computed<string | null>(() => {
  if (templateScopeKind.value === 'mine') return 'Templates of your workspaces'
  if (templateScopeKind.value === 'one') {
    const id = workspaceFilter.value !== 'all' ? workspaceFilter.value : accessibleWorkspaceIds.value[0]
    return id ? `Templates of ${workspaceLabel(id)}` : null
  }
  return null
})

const AGT_EMPTY_TEXT: Record<'none' | 'one' | 'mine', string> = {
  none: 'No ad group template yet — create one under Ad group templates first.',
  one: 'No ad group template in this workspace yet — create one under Ad group templates first.',
  mine: 'No ad group template in your workspaces yet — create one under Ad group templates first.'
}
const ADT_EMPTY_TEXT: Record<'none' | 'one' | 'mine', string> = {
  none: 'No ad template yet — create one under Ad templates first.',
  one: 'No ad template in this workspace yet — create one under Ad templates first.',
  mine: 'No ad template in your workspaces yet — create one under Ad templates first.'
}
const agtEmptyText = computed(() => AGT_EMPTY_TEXT[templateScopeKind.value])
const adtEmptyText = computed(() => ADT_EMPTY_TEXT[templateScopeKind.value])

/** available ∩ workspace ∩ search — the funded filter composes on top (`filteredAccounts`) */
const searchFilteredAccounts = computed(() => {
  const q = accountSearch.value.trim().toLowerCase()
  return availableAccounts.value.filter((account) => {
    if (workspaceFilter.value !== 'all' && account.workspace?.id !== workspaceFilter.value) return false
    if (currencyFilter.value !== CURRENCY_ALL && advertiserOf(account)?.currency !== currencyFilter.value) return false
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

/** available ∩ workspace ∩ search ∩ (funded when that switch is on) — the idle switch composes on top */
const fundedFilteredAccounts = computed(() => {
  if (!fundedOnly.value) return searchFilteredAccounts.value
  return searchFilteredAccounts.value.filter(isFunded)
})

/** … ∩ (not launching when the idle switch is on), all client-side (spec A3) */
const filteredAccounts = computed(() => {
  if (!idleOnly.value) return fundedFilteredAccounts.value
  return fundedFilteredAccounts.value.filter(a => !a.launchingAds)
})

/** FEAT-063 — what `la-acc-row` actually renders (favorites first); every other reader keeps `filteredAccounts`. */
const pinnedFilteredAccounts = computed(() => pinFavoritesFirst(filteredAccounts.value))
/** FEAT-063 — what `la-unavail-row` actually renders (favorites first); the count/label keep `unavailableAccounts`. */
const pinnedUnavailableAccounts = computed(() => pinFavoritesFirst(unavailableAccounts.value))

/** how many of the search/workspace-filtered accounts the funded switch additionally hides */
const unfundedHiddenCount = computed(() => searchFilteredAccounts.value.filter(a => !isFunded(a)).length)

/** how many of the rows that survive search/workspace/funded the idle switch additionally hides */
const launchingHiddenCount = computed(() => fundedFilteredAccounts.value.filter(a => a.launchingAds).length)

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

/** Turning the idle switch on drops launching accounts from the selection; off keeps it (mirrors the funded rule). */
watch(idleOnly, (on) => {
  if (!on) return
  const launching = availableAccounts.value.filter(a => a.launchingAds).map(a => a.id)
  selection.value = without(selection.value, launching)
  manualPicks.value = without(manualPicks.value, launching)
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
  // FEAT-083 — `computedDefaultId` already falls back to the first pickable advertiser (never a null currency)
  const id = selection.value[account.id] ?? computedDefaultId(account)
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
  if (!isPickable(advertiser)) return
  selection.value = { ...selection.value, [account.id]: advertiser.id }
  manualPicks.value = { ...manualPicks.value, [account.id]: true }
}

/** header checkbox state over the **visible** rows only (api-contract §3) */
const visibleSelectedCount = computed(() => filteredAccounts.value.filter(isSelected).length)
/** FEAT-083 — the visible rows select-all can act on (an account with no pickable advertiser never counts) */
const pickableVisibleAccounts = computed(() => filteredAccounts.value.filter(accountPickable))
const selectAllState = computed<boolean | 'indeterminate'>(() => {
  const total = pickableVisibleAccounts.value.length
  const selected = visibleSelectedCount.value
  if (total === 0 || selected === 0) return false
  return selected === total ? true : 'indeterminate'
})

/** click when not all visible selected → select every visible row; click when all selected → deselect them */
function toggleSelectAllVisible() {
  const rows = pickableVisibleAccounts.value
  if (rows.length === 0) return
  if (rows.every(isSelected)) {
    selection.value = without(selection.value, rows.map(a => a.id))
    manualPicks.value = without(manualPicks.value, rows.map(a => a.id))
    return
  }
  const picked: Record<string, string> = { ...selection.value }
  for (const account of rows) {
    const id = picked[account.id] ?? computedDefaultId(account)
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
  currencyFilter.value = CURRENCY_ALL
  fundedOnly.value = false
  idleOnly.value = false
}

/** both switches off — every available account is listed */
function showAllAccounts() {
  fundedOnly.value = false
  idleOnly.value = false
}

/** `title` of `la-acc-launching` while the account is launching — when its FEAT-029 flag went on */
function launchingTitle(account: LaunchAccount): string {
  return account.launchingSince ? `since ${formatDateTime(account.launchingSince)}` : 'since —'
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
/** the `/options` pair is fetched exactly once per page lifetime (FEAT-016 AC-14) — never on a FEAT-073 re-fetch */
let optionsLoaded = false
// FEAT-073 (spec AC-8) — bumped on every list request so a late answer of a superseded scope never overwrites
// the current one; mirrors `targetsSession` above.
let templatesSession = 0

async function loadTemplates() {
  const s = ++templatesSession
  templatesPending.value = true
  templatesError.value = null
  const ids = templateWorkspaceIds.value
  const query: Record<string, unknown> = { page: 1, limit: TEMPLATE_LIMIT }
  // FEAT-073 (api-contract.md v1 §2) — the key is omitted entirely for a GOD on "All workspaces"
  if (ids) query.workspaceIds = ids.join(',')
  const needOptions = !optionsLoaded
  try {
    // retry: 0 — two list requests every time, the two `/options` requests only on the first open
    const [groups, ads, groupOptions, adOptions] = await Promise.all([
      api<AdGroupTemplatesResponse>('/ad-group-templates', { retry: 0, query }),
      api<AdTemplatesResponse>('/ad-templates', { retry: 0, query }),
      needOptions ? api<AdGroupTemplateOptions>('/ad-group-templates/options', { retry: 0 }) : Promise.resolve(agtOptions.value),
      needOptions ? api<AdTemplateOptions>('/ad-templates/options', { retry: 0 }) : Promise.resolve(adtOptions.value)
    ])
    // a superseded scope's answer arrived after a newer one already rendered — ignore it (AC-8)
    if (s !== templatesSession) return
    agtItems.value = groups.templates ?? []
    agtTotal.value = groups.total ?? agtItems.value.length
    adtItems.value = ads.templates ?? []
    adtTotal.value = ads.total ?? adtItems.value.length
    if (needOptions) {
      agtOptions.value = groupOptions
      adtOptions.value = adOptions
      optionsLoaded = true
    }
    // FEAT-073 (spec "Selection reset", A6) — answer-driven: a selection the new scope no longer serves is
    // dropped, one it still serves survives untouched.
    let resetAny = false
    if (adGroupTemplateId.value && !agtItems.value.some(t => t.id === adGroupTemplateId.value)) {
      adGroupTemplateId.value = null
      resetAny = true
    }
    if (adTemplateId.value && !adtItems.value.some(t => t.id === adTemplateId.value)) {
      adTemplateId.value = null
      resetAny = true
    }
    if (resetAny) templateFieldError.value = null
  } catch (e) {
    if (s !== templatesSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    // allow exactly one more attempt through the Retry button
    templatesRequested = false
    templatesError.value = err.data?.error ?? err.message ?? 'Unexpected error'
  } finally {
    if (s === templatesSession) templatesPending.value = false
  }
}

function ensureTemplates() {
  if (templatesRequested) return
  templatesRequested = true
  void loadTemplates()
}

/** FEAT-073 (spec AC-12) — always re-runs with the **current** scope, not just the first-open gate */
function retryTemplates() {
  void loadTemplates()
}

// FEAT-073 (spec "Re-fetch on scope change") — repeats the two list requests (not `/options`) once the lists
// were requested at least once; a change made before step 2 was ever opened causes no request.
watch(templateWorkspaceIdsKey, () => {
  if (!templatesRequested) return
  void loadTemplates()
})

const adGroupTemplateId = ref<string | null>(null)
const adTemplateId = ref<string | null>(null)
const copies = ref(1)
/** FEAT-066 — page state like `copies` (survives step changes); only sent on publish, never on draft */
const pauseAfterPublish = ref(false)

// ── FEAT-086 · ad group guard of the order (spec §3) ─────────────────────────────────────────────────────────────────
const laGuardMode = ref<AdGroupGuardMode>('inherit')
const laGuardRule = ref<AdGroupGuardRule | null>(null)
const GUARD_MODES: AdGroupGuardMode[] = ['inherit', 'custom', 'off']
const GUARD_POPOVER_MODE_LABEL: Record<AdGroupGuardMode, string> = {
  inherit: 'ตามบัญชี / workspace',
  custom: 'กำหนดเอง',
  off: 'ไม่ใช้กฎ'
}

/** the `adGroupGuard` blocks of the selected advertisers (an absent key = no rule) */
const guardBlocks = computed(() => selectedAccounts.value.map(account => effectiveOrNone(advertiserOf(account)?.adGroupGuard)))
const guardCurrencies = computed(() => [...new Set(guardBlocks.value.map(b => b.currency).filter((c): c is string => !!c))])
/** the selection mixes currencies — one custom rule is read in each account's own currency (A3) */
const guardMixedCurrency = computed(() => guardCurrencies.value.length > 1)

const guardSummary = computed<{ text: string, source: AdGroupGuardSource | 'mixed', applies: boolean }>(() => {
  if (laGuardMode.value === 'off') return { text: 'ไม่ใช้กฎปิด ad group ใน order นี้', source: 'order', applies: false }
  if (laGuardMode.value === 'custom' && laGuardRule.value) {
    const currency = guardCurrencies.value.length === 1 ? guardCurrencies.value[0]! : null
    return {
      text: `ปิด ad group เมื่อ ${formatAdGroupGuardRule(laGuardRule.value, currency)} — กำหนดเองใน order นี้`,
      source: 'order',
      applies: true
    }
  }
  const blocks = guardBlocks.value
  const withRule = blocks.filter(b => b.rule)
  if (withRule.length === 0) return { text: 'ไม่มีกฎปิด ad group', source: 'none', applies: false }
  const first = blocks[0]!
  const same = blocks.every(b => b.source === first.source && b.currency === first.currency && sameAdGroupGuardRule(b.rule, first.rule))
  if (same && first.rule) {
    const layer = first.source === 'account' ? 'กฎของบัญชี' : 'กฎของ workspace'
    return { text: `ปิด ad group เมื่อ ${formatAdGroupGuardRule(first.rule, first.currency)} — ${layer}`, source: first.source, applies: true }
  }
  return {
    text: `ตามกฎของแต่ละบัญชี (${withRule.length} มีกฎ · ${blocks.length - withRule.length} ไม่มี)`,
    source: 'mixed',
    applies: true
  }
})

/** the confirm modal line — null when no target would be guarded */
const guardConfirmText = computed(() => (guardSummary.value.applies ? guardSummary.value.text : null))

// popover draft (applied to the page state only by "ใช้")
const guardPopoverOpen = ref(false)
const guardDraftMode = ref<AdGroupGuardMode>('inherit')
const guardDraft = ref<AdGroupGuardRuleDraft>(emptyAdGroupGuardDraft())
const guardDraftValid = ref(false)
const guardCanApply = computed(() => guardDraftMode.value !== 'custom' || guardDraftValid.value)

watch(guardPopoverOpen, (open) => {
  if (!open) return
  guardDraftMode.value = laGuardMode.value
  guardDraft.value = adGroupGuardDraftOf(laGuardRule.value)
})

function applyGuard() {
  if (!guardCanApply.value) return
  if (guardDraftMode.value === 'custom') {
    const parsed = parseAdGroupGuardDraft(guardDraft.value)
    if (!parsed.rule) return
    laGuardRule.value = parsed.rule
  }
  laGuardMode.value = guardDraftMode.value
  guardPopoverOpen.value = false
}
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

/**
 * FEAT-062 — the client-side filter of a section; the input is **always** rendered now (AS-4): the frame is
 * five rows tall, so the filter is the way to find a row, not a fallback for "more than 8".
 */
/** FEAT-083 — the template currency (view `currency`, fallback `config.budget.currency` for an older API) */
function agtCurrencyOf(template: AdGroupTemplate): string | null {
  return template.currency ?? template.config?.budget?.currency ?? null
}
/**
 * FEAT-083 (spec AC-16) — only the templates of the selection's currency are offered (client-side, the list is
 * still fetched once per page lifetime); without a single selection currency nothing is hidden.
 */
const agtCurrencyItems = computed(() => {
  const currency = selectionCurrency.value
  return currency === null ? agtItems.value : agtItems.value.filter(t => agtCurrencyOf(t) === currency)
})
const agtCurrencyHidden = computed(() => agtItems.value.length - agtCurrencyItems.value.length)
const agtFiltered = computed(() => filterByName(agtCurrencyItems.value, agtSearch.value))
/**
 * FEAT-079 — "เฉพาะโพสต์ที่ใช้ได้": drops the rows whose post is deleted / refused / not checkable, before the
 * fold split. Never-checked (`postInfo` null) and `verifying` rows stay. Remembered across visits.
 */
const adtOnlyAvailable = useLocalStorage('la-adt-filter-available', false)
function isAdtPostUnavailable(template: AdTemplate): boolean {
  const status = template.postInfo?.status
  return isPostDeleted(template.postInfo) || status === 'invalid' || status === 'failed'
}
const adtSearched = computed(() => filterByName(adtItems.value, adtSearch.value))
const adtFiltered = computed(() =>
  adtOnlyAvailable.value ? adtSearched.value.filter(t => !isAdtPostUnavailable(t)) : adtSearched.value
)
const adtFilterHidden = computed(() => adtSearched.value.length - adtFiltered.value.length)

/** FEAT-079 — a post that TikTok deleted cannot be launched: the row is disabled and the card is not selectable */
function isAdtDeleted(template: AdTemplate): boolean {
  return isPostDeleted(template.postInfo)
}

/** set when a refresh found the selected template's post deleted and the selection was cleared */
const adtDeletedNotice = ref<string | null>(null)
watch(adtItems, (items) => {
  const selected = items.find(t => t.id === adTemplateId.value)
  if (selected && isPostDeleted(selected.postInfo)) {
    adtDeletedNotice.value = postInfoReason(selected.postInfo)
    adTemplateId.value = null
  }
})

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

/**
 * FEAT-061 — the row's kind: the API's own `kind` when it serves one, else the FEAT-011 catalog comparison
 * (an API that predates the feature). `null` while `/options` has not answered — never cry wolf.
 */
function agtKindOf(template: AdGroupTemplate): AdGroupTemplateKind | null {
  if (template.kind) return template.kind
  const current = agtOptions.value?.catalogVersion
  if (!current) return null
  return template.catalogVersion === current ? 'smartPlus' : 'manual'
}

/** FEAT-061 — a manual ad-group template cannot create an order any more (the API answers 400) */
function isAgtManual(template: AdGroupTemplate): boolean {
  return agtKindOf(template) === 'manual'
}

function isAdtStale(template: AdTemplate): boolean {
  const current = adtOptions.value?.catalogVersion
  if (!current) return false
  return template.catalogVersion !== current
}

/**
 * FEAT-062 — the two groups of a section, computed on the **search-filtered** list: the rows that can be
 * launched, and the ones that cannot (manual ad-group templates / older-catalog ad templates). The second
 * group is rendered after the first, inside a `hidden` wrapper, so it stays in the DOM (counts and
 * `data-stale` assertions keep working) while taking no space until the fold link opens it (AS-1).
 */
const agtUsable = computed(() => agtFiltered.value.filter(t => !isAgtManual(t)))
const agtFolded = computed(() => agtFiltered.value.filter(isAgtManual))
// the rows of the first group include the deleted ones (rendered disabled, FEAT-079) — the count tells how many can be picked
const adtUsable = computed(() => adtFiltered.value.filter(t => !isAdtStale(t)))
const adtPickableCount = computed(() => adtUsable.value.filter(t => !isAdtDeleted(t)).length)
const adtFolded = computed(() => adtFiltered.value.filter(isAdtStale))

const agtFoldOpen = ref(false)
const adtFoldOpen = ref(false)

const AGT_FOLD_REASON = 'ต้องปรับเป็น Smart+'
const ADT_FOLD_REASON = 'older catalog'

/** `N ใช้ได้` + ` · M <reason>` while something is folded away */
function countText(usable: number, folded: number, reason: string): string {
  return folded > 0 ? `${usable} ใช้ได้ · ${folded} ${reason}` : `${usable} ใช้ได้`
}

const agtCountText = computed(() => countText(agtUsable.value.length, agtFolded.value.length, AGT_FOLD_REASON))
const adtCountText = computed(() => countText(adtPickableCount.value, adtFolded.value.length, ADT_FOLD_REASON))

const agtMoreText = computed(() =>
  agtFoldOpen.value
    ? 'ซ่อนรายการที่ต้องปรับเป็น Smart+ ก่อน'
    : `แสดงอีก ${agtFolded.value.length} รายการที่ต้องปรับเป็น Smart+ ก่อน`
)
const adtMoreText = computed(() =>
  adtFoldOpen.value
    ? 'ซ่อนรายการที่เป็น older catalog'
    : `แสดงอีก ${adtFolded.value.length} รายการที่เป็น older catalog`
)

function selectAdGroupTemplate(template: AdGroupTemplate) {
  if (isAgtManual(template)) return
  adGroupTemplateId.value = template.id
  templateFieldError.value = null
}

function selectAdTemplate(template: AdTemplate) {
  if (isAdtStale(template) || isAdtDeleted(template)) return
  adTemplateId.value = template.id
  adtDeletedNotice.value = null
  templateFieldError.value = null
}

/**
 * FEAT-062 (spec AS-9 / AC-9) — the preview re-read one ad template because an image URL had expired: swap
 * that row in the list so the row thumb, the Summary preview and the Review preview all use the fresh view.
 * A view of a template that is no longer in the list is ignored (nothing to update).
 */
function replaceAdTemplate(view: AdTemplate) {
  adtItems.value = adtItems.value.map(row => (row.id === view.id ? { ...row, ...view } : row))
}

/**
 * FEAT-061 — the campaign-level budget line of a v3 card: `CBO <amount> <currency label>/<type label>` under
 * CBO, else the `adGroup` label of `/options.budgetStrategy` (the ad group's own budget is the line above).
 * `''` for a manual row — it has no campaign section at all.
 */
function campaignCell(template: AdGroupTemplate): string {
  const campaign = template.config?.campaign
  if (!campaign?.budgetStrategy) return ''
  if (campaign.budgetStrategy !== 'cbo') {
    return labelOf(agtOptions.value?.budgetStrategy, 'adGroup')
  }
  const budget = campaign.budget
  const amount = Number.isFinite(budget?.amount) ? budget!.amount.toFixed(2) : '—'
  return `CBO ${amount} ${labelOf(agtOptions.value?.currency, budget?.currency)}/${labelOf(agtOptions.value?.budgetType, budget?.type)}`
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

/**
 * locations · age groups · gender, all three with the labels of `/options`.
 * TASK-adgroup-targeting: a template that asks for TikTok's **manual** targeting says so at the end (the label
 * comes from `options.targetingMode`); `auto` is the contract default and adds nothing.
 */
function targetingCell(template: AdGroupTemplate): string {
  const config = template.config
  const locations = (config?.locations ?? []).map(v => labelOf(agtOptions.value?.locations, v)).join(', ') || '—'
  const ages = (config?.ageGroups ?? []).length === 0
    ? (agtOptions.value?.ageGroupsUnlimitedLabel ?? '—')
    : config.ageGroups.map(v => labelOf(agtOptions.value?.ageGroups, v)).join(', ')
  const parts = [locations, ages, labelOf(agtOptions.value?.gender, config?.gender)]
  if (config?.targetingMode && config.targetingMode !== 'auto') {
    parts.push(labelOf(agtOptions.value?.targetingMode, config.targetingMode))
  }
  return parts.join(' · ')
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

/**
 * FEAT-042 — the selected ad template's post was refused, could not be checked or was never checked
 * (`verifying` is not a warning: the result may still arrive before the build reaches the ad stage).
 * Display only — nothing about the selection or the submit depends on it.
 */
const adTemplatePostWarning = computed(() =>
  !!adTemplate.value && needsPostInfoWarning(adTemplate.value.postInfo)
)

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
/**
 * TASK-theme-cbo-cap — the budget the confirm dialog's cap is built on: the **campaign** budget under CBO (shared
 * by the copies, so counted once per account), else the ad-group budget (× copies × accounts) — `capBasis`.
 */
const capBudget = computed(() => capBasis(adGroupTemplate.value?.config ?? null, copies.value))
const budget = computed(() => capBudget.value.budget)
const budgetIsCbo = computed(() => capBudget.value.cbo)
const budgetTypeLabel = computed(() => labelOf(agtOptions.value?.budgetType, budget.value?.type))

// ── stepper ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const step = ref(1)
/**
 * FEAT-083 (spec AC-14) — one currency per launch: the currencies of the selected advertisers (a selection only
 * ever holds pickable = known-currency advertisers). More than one → Next disabled + `la-currency-mixed`.
 */
const selectionCurrencyCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const account of selectedAccounts.value) {
    const advertiser = account.advertisers.find(a => a.id === selection.value[account.id])
    const currency = advertiser?.currency ?? '?'
    counts.set(currency, (counts.get(currency) ?? 0) + 1)
  }
  return counts
})
const selectionCurrencies = computed(() => [...selectionCurrencyCounts.value.keys()])
const currencyMixed = computed(() => selectionCurrencies.value.length > 1)
/** the single currency of the selection, `null` when nothing (or a mix) is selected */
const selectionCurrency = computed(() =>
  selectionCurrencies.value.length === 1 ? (selectionCurrencies.value[0] as string) : null
)
/** `THB 2 · USD 1` */
const currencyMixedCounts = computed(() =>
  [...selectionCurrencyCounts.value].map(([currency, n]) => `${currency} ${n}`).join(' · ')
)
const canLeaveStep1 = computed(() => selectedCount.value > 0 && !currencyMixed.value)

/** FEAT-083 (AC-16) — a picked template of another currency (the selection changed after the pick) is dropped */
watch([selectionCurrency, agtItems], ([currency]) => {
  const picked = adGroupTemplate.value
  if (picked && currency !== null && agtCurrencyOf(picked) !== currency) adGroupTemplateId.value = null
})
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
    // FEAT-066 (A5) — omit the key unless publishing with the box checked; draft never sends it, and every
    // existing exact-body assertion that predates this flag keeps passing
    ...(publishMode === 'publish' && pauseAfterPublish.value ? { pauseAfterPublish: true } : {}),
    // FEAT-086 — omitted for inherit and for every draft (the API answers 400 for draft + key)
    ...(publishMode === 'publish' && laGuardMode.value !== 'inherit'
      ? { adGroupGuard: laGuardMode.value === 'custom' && laGuardRule.value
          ? { mode: 'custom' as const, rule: laGuardRule.value }
          : { mode: 'off' as const } }
      : {}),
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

/** FEAT-083 — 409 `currencyUnknown`: drop those accounts, toast, back to step 1 and re-read the targets */
function onCurrencyUnknown(advertisers: CreateOrderCurrencyUnknownBody['advertisers'], message: string) {
  toast.add({
    title: 'ยังไม่รู้สกุลเงินของ advertiser',
    description: [message, ...advertisers.map(a => a.name)].filter(Boolean).join(' · '),
    color: 'warning',
    icon: 'i-lucide-triangle-alert'
  })
  const ids = advertisers.map(a => a.tiktokAccountId)
  selection.value = without(selection.value, ids)
  manualPicks.value = without(manualPicks.value, ids)
  step.value = 1
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
    const err = e as FetchError<Partial<ApiErrorBody & CreateOrderRejectedBody & CreateOrderCurrencyUnknownBody>>
    const status = err.response?.status ?? err.statusCode
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    publishOpen.value = false
    const rejected = err.data?.rejected
    if (status === 409 && Array.isArray(rejected)) {
      formError.value = message
      onRejected(rejected)
    } else if (status === 409 && err.data?.reason === 'currencyUnknown') {
      // FEAT-083 (api-contract v1 §4) — same path as the readiness 409: back to step 1, re-read the targets
      formError.value = message
      onCurrencyUnknown(err.data.advertisers ?? [], message)
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

const hasAccountSearch = computed(() =>
  accountSearch.value.trim() !== '' || workspaceFilter.value !== 'all' || currencyFilter.value !== CURRENCY_ALL
)
const showAccountsEmpty = computed(() =>
  targetsLoaded.value && !targetsError.value && !forbidden.value && availableAccounts.value.length === 0
)
/** idle switch on, no search/workspace filter, and it alone hides every remaining row */
const showAccountsNoLaunching = computed(() =>
  !showAccountsEmpty.value && idleOnly.value && !hasAccountSearch.value
  && filteredAccounts.value.length === 0 && launchingHiddenCount.value > 0
)
/** switch on, no search/workspace filter, every available account unfunded (spec AC-9) */
const showAccountsNoFunded = computed(() =>
  !showAccountsEmpty.value && !showAccountsNoLaunching.value && fundedOnly.value && !hasAccountSearch.value
  && filteredAccounts.value.length === 0
)
const showAccountsNoMatch = computed(() =>
  !showAccountsEmpty.value && !showAccountsNoLaunching.value && !showAccountsNoFunded.value
  && filteredAccounts.value.length === 0 && hasAccountSearch.value
)

onMounted(() => {
  void loadTargets()
})

onUnmounted(() => {
  targetsSession++
  templatesSession++
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
            @click="refreshAll()"
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
        :data-idle-only="idleOnly ? 'true' : 'false'"
        class="flex flex-1 flex-col gap-4 pb-28 sm:pb-20 lg:pb-0"
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

          <!-- FEAT-062 round 4 — 3/5 + 2/5 at `lg+`: a wider Summary (AC-15) -->
          <div class="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-5">
            <!-- ── step content ─────────────────────────────────────────────────────────────────────── -->
            <div class="flex min-w-0 flex-col gap-4 lg:col-span-3">
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
                    title="Filters the accounts and the templates"
                    aria-description="Filters the accounts and the templates"
                    data-testid="la-acc-ws"
                  />
                  <USwitch
                    v-model="fundedOnly"
                    label="Only with balance"
                    data-testid="la-acc-funded"
                  />
                  <USwitch
                    v-model="idleOnly"
                    label="Only not launching"
                    data-testid="la-acc-idle"
                  />
                  <USelect
                    v-model="currencyFilter"
                    :items="currencyFilterItems"
                    :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
                    class="min-w-32"
                    aria-label="Currency"
                    data-testid="la-filter-currency"
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

                <!-- FEAT-083 (AC-14) — one currency per launch: a mixed selection blocks Next -->
                <UAlert
                  v-if="currencyMixed"
                  color="warning"
                  variant="subtle"
                  icon="i-lucide-coins"
                  title="เลือกได้ครั้งละหนึ่งสกุลเงิน"
                  :description="currencyMixedCounts"
                  data-testid="la-currency-mixed"
                />

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
                  v-else-if="showAccountsNoLaunching"
                  icon="i-lucide-rocket"
                  title="Every account is launching ads"
                  :description="`Turn the filter off to see ${launchingHiddenCount} account(s)`"
                  data-testid="la-acc-nolaunching"
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
                      <template v-for="account in pinnedFilteredAccounts" :key="account.id">
                        <tr
                          :data-id="account.id"
                          :data-selected="isSelected(account) ? 'true' : 'false'"
                          :data-funded="isFunded(account) ? 'true' : 'false'"
                          :data-launching="account.launchingAds ? 'true' : 'false'"
                          :data-favorite="effectiveFavorite(account) ? 'true' : 'false'"
                          :data-currency="accountPickable(account) ? accountCurrency(account) : 'unknown'"
                          data-slot="tr"
                          data-testid="la-acc-row"
                        >
                          <td class="border-b border-default px-3 py-2">
                            <UCheckbox
                              :model-value="isSelected(account)"
                              :aria-label="`Select ${accountName(account)}`"
                              :disabled="!accountPickable(account) && !isSelected(account)"
                              data-testid="la-acc-check"
                              @update:model-value="(v: boolean | 'indeterminate') => setSelected(account, v === true)"
                            />
                          </td>
                          <td class="border-b border-default px-3 py-2">
                            <div class="flex min-w-0 flex-col">
                              <div class="flex min-w-0 items-center gap-1">
                                <span class="truncate font-medium text-highlighted" data-testid="la-acc-name">{{ accountName(account) }}</span>
                                <TiktokAccountsFavoriteStar
                                  :account-id="account.id"
                                  :favorite="effectiveFavorite(account)"
                                  testid="la-acc-fav"
                                  @update:favorite="(v: boolean) => onFavoriteChange(account.id, v)"
                                />
                              </div>
                              <span v-if="accountEmail(account)" class="text-xs text-muted">{{ accountEmail(account) }}</span>
                              <!-- FEAT-029 flag of the account — launch status -->
                              <UBadge
                                v-if="account.launchingAds"
                                color="success"
                                variant="subtle"
                                size="sm"
                                icon="i-lucide-rocket"
                                class="mt-0.5 self-start whitespace-nowrap"
                                :title="launchingTitle(account)"
                                data-testid="la-acc-launching"
                                data-launching="true"
                                :data-since="account.launchingSince ?? ''"
                              >
                                Launching ads
                              </UBadge>
                              <UBadge
                                v-else
                                color="neutral"
                                variant="subtle"
                                size="sm"
                                class="mt-0.5 self-start whitespace-nowrap"
                                data-testid="la-acc-launching"
                                data-launching="false"
                              >
                                Not launching
                              </UBadge>
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
                              <span class="flex flex-wrap items-center gap-1 text-xs text-muted">
                                <span>{{ advertiserOf(account)?.tiktokAdvertiserId ?? '—' }}</span>
                                <UBadge
                                  :color="accountCurrency(account) === '?' ? 'warning' : 'info'"
                                  variant="subtle"
                                  size="sm"
                                  data-testid="la-acc-currency"
                                >
                                  {{ accountCurrency(account) }}
                                </UBadge>
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
                              <span
                                v-if="!accountPickable(account)"
                                class="text-xs text-warning"
                                data-testid="la-acc-currency-unknown"
                              >
                                {{ CURRENCY_UNKNOWN_HINT }}
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
                                :data-currency="advertiser.currency ?? 'unknown'"
                                data-testid="la-adv-option"
                                class="flex flex-wrap items-center gap-2 rounded-md px-2 py-1"
                              >
                                <input
                                  type="radio"
                                  class="size-4"
                                  :name="`advertiser-${account.id}`"
                                  :checked="selection[account.id] === advertiser.id"
                                  :disabled="!isPickable(advertiser)"
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
                                <UBadge
                                  v-if="advertiser.currency"
                                  color="info"
                                  variant="subtle"
                                  size="sm"
                                  data-testid="la-adv-currency"
                                >
                                  {{ advertiser.currency }}
                                </UBadge>
                                <span
                                  v-else
                                  class="text-xs text-warning"
                                  data-testid="la-adv-currency-unknown"
                                >
                                  {{ CURRENCY_UNKNOWN_HINT }}
                                </span>
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
                      v-for="account in pinnedUnavailableAccounts"
                      :key="account.id"
                      :data-id="account.id"
                      :data-favorite="effectiveFavorite(account) ? 'true' : 'false'"
                      data-testid="la-unavail-row"
                      class="flex flex-wrap items-center gap-2 rounded-lg border border-default px-3 py-2 text-sm"
                    >
                      <span class="font-medium text-highlighted">{{ accountName(account) }}</span>
                      <TiktokAccountsFavoriteStar
                        :account-id="account.id"
                        :favorite="effectiveFavorite(account)"
                        testid="la-acc-fav"
                        @update:favorite="(v: boolean) => onFavoriteChange(account.id, v)"
                      />
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
                <!-- FEAT-073 — scope line under the step title; absent for a GOD on "All workspaces" -->
                <p
                  v-if="templateScopeLine"
                  class="text-xs text-muted"
                  data-testid="la-tpl-scope"
                >
                  {{ templateScopeLine }}
                </p>

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
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-sm font-semibold text-highlighted">
                      Ad group template
                    </h2>
                    <span class="text-xs text-muted tabular-nums" data-testid="la-agt-count">
                      {{ agtCountText }}
                    </span>
                    <div class="grow" />
                    <label class="flex items-center gap-1.5 text-xs text-muted">
                      Copies
                      <USelect
                        v-model="copies"
                        :items="copiesItems"
                        :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
                        class="w-20"
                        size="sm"
                        aria-label="Ad group copies"
                        title="Ad groups per campaign — same settings, same budget each"
                        aria-description="Ad groups per campaign — same settings, same budget each"
                        data-testid="la-copies"
                      />
                    </label>
                    <UInput
                      v-model="agtSearch"
                      icon="i-lucide-search"
                      size="sm"
                      class="w-full sm:w-48"
                      placeholder="Filter templates"
                      aria-label="Filter ad group templates"
                      data-testid="la-agt-search"
                    />
                  </div>
                  <!-- FEAT-083 (AC-16) — templates of another currency are not offered -->
                  <p
                    v-if="!templatesPending && agtCurrencyHidden > 0 && selectionCurrency"
                    class="text-xs text-muted"
                    data-testid="la-agt-currency-hidden"
                  >
                    ซ่อน {{ agtCurrencyHidden }} template สกุลอื่น ({{ selectionCurrency }})
                  </p>
                  <p v-if="!templatesPending && agtCurrencyItems.length === 0" class="text-sm text-muted" data-testid="la-agt-empty">
                    {{ agtItems.length > 0 && selectionCurrency ? `ไม่มี template สกุล ${selectionCurrency}` : agtEmptyText }}
                  </p>
                  <!-- exactly 5 rows (5 × 52 px + the frame's own 2 px borders), the rest scrolls (AC-13) -->
                  <div
                    v-else
                    class="max-h-[262px] divide-y divide-default overflow-y-auto rounded-lg border border-default"
                    role="radiogroup"
                    aria-label="Ad group template"
                    data-testid="la-agt-list"
                  >
                    <button
                      v-for="template in agtUsable"
                      :key="template.id"
                      type="button"
                      role="radio"
                      :aria-checked="template.id === adGroupTemplateId"
                      :data-id="template.id"
                      :data-selected="template.id === adGroupTemplateId ? 'true' : 'false'"
                      data-stale="false"
                      :data-kind="agtKindOf(template) ?? undefined"
                      :data-currency="agtCurrencyOf(template) ?? 'unknown'"
                      data-testid="la-agt-card"
                      class="grid h-13 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden
                        px-2 py-1.5 text-left hover:bg-elevated focus-visible:inset-ring-2
                        focus-visible:inset-ring-primary focus-visible:outline-none"
                      :class="template.id === adGroupTemplateId
                        ? 'bg-primary/10 inset-ring-2 inset-ring-primary/40'
                        : 'bg-default'"
                      @click="selectAdGroupTemplate(template)"
                    >
                      <span
                        class="flex size-4 items-center justify-center rounded-full border"
                        :class="template.id === adGroupTemplateId ? 'border-primary' : 'border-accented'"
                      >
                        <span v-if="template.id === adGroupTemplateId" class="size-2 rounded-full bg-primary" />
                      </span>
                      <span class="flex min-w-0 flex-col">
                        <span class="truncate text-sm font-medium text-highlighted" :title="template.name">
                          {{ template.name }}
                        </span>
                        <span class="truncate text-xs text-muted">
                          <span :title="budgetCell(template)">{{ budgetCell(template) }}</span>
                          <!-- FEAT-061 — the campaign-level strategy/budget of a v3 template -->
                          <template v-if="campaignCell(template)">
                            <span class="text-dimmed"> · </span>
                            <span
                              :title="campaignCell(template)"
                              data-testid="la-agt-campaign"
                            >{{ campaignCell(template) }}</span>
                          </template>
                          <span class="text-dimmed"> · </span>
                          <span :title="scheduleCell(template)">{{ scheduleCell(template) }}</span>
                          <span class="text-dimmed"> · </span>
                          <span :title="targetingCell(template)">{{ targetingCell(template) }}</span>
                        </span>
                      </span>
                      <span class="hidden text-right text-xs text-dimmed tabular-nums sm:block">
                        catalog {{ catalogCell(template.catalogVersion) }}<br>
                        updated {{ timeAgo(template.updatedAt) }}
                      </span>
                    </button>

                    <!-- FEAT-062 — manual rows stay in the DOM, folded away until `la-agt-more` opens them -->
                    <div
                      v-if="agtFolded.length > 0"
                      class="divide-y divide-default"
                      :hidden="!agtFoldOpen"
                      data-testid="la-agt-hidden"
                    >
                      <button
                        v-for="template in agtFolded"
                        :key="template.id"
                        type="button"
                        role="radio"
                        aria-checked="false"
                        :data-id="template.id"
                        data-selected="false"
                        data-stale="true"
                        :data-kind="agtKindOf(template) ?? undefined"
                        :data-currency="agtCurrencyOf(template) ?? 'unknown'"
                        disabled
                        data-testid="la-agt-card"
                        class="grid h-13 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2
                          overflow-hidden bg-default px-2 py-1.5 text-left opacity-60"
                        @click="selectAdGroupTemplate(template)"
                      >
                        <span class="flex size-4 items-center justify-center rounded-full border border-accented" />
                        <span class="flex min-w-0 flex-col">
                          <span class="flex min-w-0 items-center gap-1.5">
                            <span class="truncate text-sm font-medium text-highlighted" :title="template.name">
                              {{ template.name }}
                            </span>
                            <!-- FEAT-061 — a manual row cannot be launched; it has to be migrated first -->
                            <UBadge
                              color="warning"
                              variant="subtle"
                              size="sm"
                              class="whitespace-nowrap"
                            >
                              manual
                            </UBadge>
                            <span class="whitespace-nowrap text-xs text-warning" data-testid="la-agt-manual">
                              ต้องปรับเป็น Smart+ ก่อน
                            </span>
                          </span>
                          <span class="truncate text-xs text-muted">
                            <span :title="budgetCell(template)">{{ budgetCell(template) }}</span>
                            <template v-if="campaignCell(template)">
                              <span class="text-dimmed"> · </span>
                              <span
                                :title="campaignCell(template)"
                                data-testid="la-agt-campaign"
                              >{{ campaignCell(template) }}</span>
                            </template>
                            <span class="text-dimmed"> · </span>
                            <span :title="scheduleCell(template)">{{ scheduleCell(template) }}</span>
                            <span class="text-dimmed"> · </span>
                            <span :title="targetingCell(template)">{{ targetingCell(template) }}</span>
                          </span>
                        </span>
                        <span class="hidden text-right text-xs text-dimmed tabular-nums sm:block">
                          catalog {{ catalogCell(template.catalogVersion) }}<br>
                          updated {{ timeAgo(template.updatedAt) }}
                        </span>
                      </button>
                    </div>
                  </div>
                  <UButton
                    v-if="agtFolded.length > 0"
                    :label="agtMoreText"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="self-start px-0"
                    :aria-expanded="agtFoldOpen"
                    data-testid="la-agt-more"
                    @click="agtFoldOpen = !agtFoldOpen"
                  />
                </section>

                <!-- ad template — its frame takes what is left of the panel body at `lg+` (AC-14) -->
                <section class="flex flex-col gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-sm font-semibold text-highlighted">
                      Ad template
                    </h2>
                    <span class="text-xs text-muted tabular-nums" data-testid="la-adt-count">
                      {{ adtCountText }}
                    </span>
                    <div class="grow" />
                    <USwitch
                      v-model="adtOnlyAvailable"
                      size="sm"
                      label="เฉพาะโพสต์ที่ใช้ได้"
                      data-testid="la-adt-filter-available"
                    />
                    <span
                      v-if="adtOnlyAvailable && adtFilterHidden > 0"
                      class="text-xs text-muted tabular-nums"
                      data-testid="la-adt-filter-hidden"
                    >
                      ซ่อน {{ adtFilterHidden }} รายการ
                    </span>
                    <UInput
                      v-model="adtSearch"
                      icon="i-lucide-search"
                      size="sm"
                      class="w-full sm:w-48"
                      placeholder="Filter templates"
                      aria-label="Filter ad templates"
                      data-testid="la-adt-search"
                    />
                  </div>
                  <p v-if="!templatesPending && adtItems.length === 0" class="text-sm text-muted" data-testid="la-adt-empty">
                    {{ adtEmptyText }}
                  </p>
                  <!--
                    below `lg`: exactly 5 rows (5 × 60 px + the frame's 2 px borders) like the ad-group frame;
                    at `lg+`: the rest of the panel body — `100vh` minus the measured 596 px above/below this
                    frame (navbar + stepper + ad-group section + both headers + the fold link + the body's own
                    bottom padding), never shorter than those 5 rows (AC-13 / AC-14). A pure flex chain cannot
                    do it here: the page body is the scroll container and `la-page` is content-sized, so no
                    ancestor has a definite height to distribute (see bo.md round 4).
                  -->
                  <div
                    v-else
                    class="max-h-[302px] divide-y divide-default overflow-y-auto rounded-lg border border-default
                      lg:h-[calc(100vh-596px)] lg:max-h-none lg:min-h-[302px]"
                    role="radiogroup"
                    aria-label="Ad template"
                    data-testid="la-adt-list"
                  >
                    <button
                      v-for="template in adtUsable"
                      :key="template.id"
                      type="button"
                      role="radio"
                      :aria-checked="!isAdtDeleted(template) && template.id === adTemplateId"
                      :data-id="template.id"
                      :data-selected="!isAdtDeleted(template) && template.id === adTemplateId ? 'true' : 'false'"
                      data-stale="false"
                      :data-deleted="isAdtDeleted(template) ? 'true' : undefined"
                      :disabled="isAdtDeleted(template)"
                      data-testid="la-adt-card"
                      class="grid h-15 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 overflow-hidden
                        px-2 py-1.5 text-left focus-visible:inset-ring-2
                        focus-visible:inset-ring-primary focus-visible:outline-none"
                      :class="isAdtDeleted(template)
                        ? 'bg-default opacity-60'
                        : template.id === adTemplateId
                          ? 'bg-primary/10 inset-ring-2 inset-ring-primary/40 hover:bg-elevated'
                          : 'bg-default hover:bg-elevated'"
                      @click="selectAdTemplate(template)"
                    >
                      <span
                        class="flex size-4 items-center justify-center rounded-full border"
                        :class="!isAdtDeleted(template) && template.id === adTemplateId ? 'border-primary' : 'border-accented'"
                      >
                        <span
                          v-if="!isAdtDeleted(template) && template.id === adTemplateId"
                          class="size-2 rounded-full bg-primary"
                        />
                      </span>
                      <span class="flex min-w-0 flex-col">
                        <span class="flex min-w-0 items-center gap-1.5">
                          <!-- FEAT-042 — the cover of the bound post, only when one is stored -->
                          <AdTemplatesPostCover
                            v-if="hasPostCover(template.postInfo)"
                            :template-id="template.id"
                            :checked-at="postInfoCheckedAt(template.postInfo)"
                            ok
                            testid="la-adt-post-thumb"
                          />
                          <span class="truncate text-sm font-medium text-highlighted" :title="template.name">
                            {{ template.name }}
                          </span>
                          <AdTemplatesPostStatus :post-info="template.postInfo" testid="la-adt-post-status" />
                        </span>
                        <span
                          v-if="isAdtDeleted(template)"
                          class="truncate text-xs text-error"
                          :title="postInfoReason(template.postInfo) ?? undefined"
                          data-testid="la-card-deleted"
                        >
                          {{ postInfoReason(template.postInfo) }}
                        </span>
                        <span v-else class="truncate text-xs text-muted">
                          <span :title="postCell(template)">{{ postCell(template) }}</span>
                          <span class="text-dimmed"> · </span>
                          <span :title="pageCell(template)">{{ pageCell(template) }}</span>
                          <span class="text-dimmed"> · </span>
                          <span :title="ctaCell(template)">{{ ctaCell(template) }}</span>
                        </span>
                      </span>
                      <span class="hidden text-right text-xs text-dimmed tabular-nums sm:block">
                        catalog {{ catalogCell(template.catalogVersion) }}<br>
                        updated {{ timeAgo(template.updatedAt) }}
                      </span>
                    </button>

                    <!-- FEAT-062 — older-catalog rows stay in the DOM, folded away until `la-adt-more` -->
                    <div
                      v-if="adtFolded.length > 0"
                      class="divide-y divide-default"
                      :hidden="!adtFoldOpen"
                      data-testid="la-adt-hidden"
                    >
                      <button
                        v-for="template in adtFolded"
                        :key="template.id"
                        type="button"
                        role="radio"
                        aria-checked="false"
                        :data-id="template.id"
                        data-selected="false"
                        data-stale="true"
                        disabled
                        data-testid="la-adt-card"
                        class="grid h-15 w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2
                          overflow-hidden bg-default px-2 py-1.5 text-left opacity-60"
                        @click="selectAdTemplate(template)"
                      >
                        <span class="flex size-4 items-center justify-center rounded-full border border-accented" />
                        <span class="flex min-w-0 flex-col">
                          <span class="flex min-w-0 items-center gap-1.5">
                            <AdTemplatesPostCover
                              v-if="hasPostCover(template.postInfo)"
                              :template-id="template.id"
                              :checked-at="postInfoCheckedAt(template.postInfo)"
                              ok
                              testid="la-adt-post-thumb"
                            />
                            <span class="truncate text-sm font-medium text-highlighted" :title="template.name">
                              {{ template.name }}
                            </span>
                            <AdTemplatesPostStatus :post-info="template.postInfo" testid="la-adt-post-status" />
                            <UBadge
                              color="warning"
                              variant="subtle"
                              size="sm"
                              class="whitespace-nowrap"
                            >
                              Older catalog
                            </UBadge>
                          </span>
                          <span class="truncate text-xs text-warning" data-testid="la-card-stale">
                            Built from an older catalog — open it in Ad templates and save it again
                          </span>
                        </span>
                        <span class="hidden text-right text-xs text-dimmed tabular-nums sm:block">
                          catalog {{ catalogCell(template.catalogVersion) }}<br>
                          updated {{ timeAgo(template.updatedAt) }}
                        </span>
                      </button>
                    </div>
                  </div>
                  <UButton
                    v-if="adtFolded.length > 0"
                    :label="adtMoreText"
                    color="neutral"
                    variant="link"
                    size="xs"
                    class="self-start px-0"
                    :aria-expanded="adtFoldOpen"
                    data-testid="la-adt-more"
                    @click="adtFoldOpen = !adtFoldOpen"
                  />

                  <!-- FEAT-042 — non-blocking: the order can still be created, it may fail at the ad stage -->
                  <UAlert
                    v-if="adTemplatePostWarning || adtDeletedNotice"
                    color="warning"
                    variant="subtle"
                    icon="i-lucide-triangle-alert"
                    :title="adtDeletedNotice
                      ? 'โพสต์ของ template ที่เลือกถูกลบแล้ว — เลือก template อื่น'
                      : 'โพสต์ของ template นี้ยังไม่ได้ตรวจ/ตรวจไม่ผ่าน — build อาจล้มที่ขั้นโฆษณา'"
                    :description="adtDeletedNotice ?? postInfoReason(adTemplate?.postInfo) ?? undefined"
                    data-testid="la-adt-post-warning"
                  />
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

                  <!-- FEAT-062 — the same preview as the Summary shows on steps 1–2 (AS-3) -->
                  <LaunchAdsAdPreview
                    class="mt-3"
                    :template="adTemplate"
                    :options="adtOptions"
                    testid="la-review-preview"
                    @updated="replaceAdTemplate"
                  />
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
                      <TiktokAccountsFavoriteStar
                        v-if="effectiveFavorite(account)"
                        :account-id="account.id"
                        :favorite="true"
                        testid="la-review-fav"
                        readonly
                      />
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
            </div>

            <!-- ── summary ───────────────────────────────────────────────────────────────────────────── -->
            <aside
              class="flex flex-col gap-2 rounded-lg border border-default p-3 lg:sticky lg:top-4 lg:col-span-2"
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
                <!-- FEAT-083 — the selection currency (`—` for none or a mix) -->
                <dt class="text-muted">
                  Currency
                </dt>
                <dd class="text-right text-highlighted" data-testid="la-sum-currency">
                  {{ selectionCurrency ?? '—' }}
                </dd>
                <dt class="text-muted">
                  Ad group template
                </dt>
                <dd class="truncate text-right text-highlighted" :data-id="adGroupTemplateId ?? ''" data-testid="la-agt-selected">
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
              <!-- FEAT-062 — the fixed campaign preset lives here now, on every step (AS-6) -->
              <div class="flex flex-col gap-0.5 border-t border-default pt-2 text-xs" data-testid="la-campaign-fixed">
                <span class="text-sm font-semibold text-highlighted">Campaign · fixed</span>
                <span class="text-highlighted">
                  <span data-testid="la-campaign-objective">Sales cashback</span>
                  <span class="text-dimmed"> → </span>
                  <span data-testid="la-campaign-destination">Website conversions</span>
                </span>
                <span class="text-muted">Campaign name = order name</span>
              </div>

              <!-- FEAT-062 — step 3 renders the same component in the review column instead (AS-3) -->
              <LaunchAdsAdPreview
                v-if="step < 3"
                :template="adTemplate"
                :options="adtOptions"
                testid="la-preview"
                @updated="replaceAdTemplate"
              />

              <p class="text-xs text-muted">
                Save as draft stops each build at <span class="font-medium">ready</span>; Create &amp; publish
                publishes on TikTok as soon as the build finishes.
              </p>

              <!-- FEAT-066 — above the action buttons (human decision §0.1); no effect on Save as draft -->
              <UCheckbox
                v-model="pauseAfterPublish"
                label="ปิด campaign ทันทีหลังเผยแพร่"
                description="ระบบจะปิดให้หลังรอบ KPI ถัดไป"
                data-testid="la-pause-after-publish"
              />

              <!-- FEAT-086 — the ad group guard this order will snapshot (Create & publish only) -->
              <div class="flex flex-col gap-1 rounded-md border border-default p-2 text-xs" data-testid="la-adgroup-guard">
                <div class="flex items-start gap-2">
                  <UIcon name="i-lucide-shield-alert" class="mt-0.5 size-4 shrink-0 text-muted" />
                  <span
                    class="min-w-0 grow break-words text-highlighted"
                    data-testid="la-adgroup-guard-text"
                    :data-mode="laGuardMode"
                    :data-source="guardSummary.source"
                  >{{ guardSummary.text }}</span>
                  <UPopover v-model:open="guardPopoverOpen" :content="{ align: 'end', side: 'top' }">
                    <UButton
                      label="แก้"
                      icon="i-lucide-pencil"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      class="shrink-0"
                      data-testid="la-adgroup-guard-edit"
                    />
                    <template #content>
                      <div class="flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 p-3" data-testid="la-adgroup-guard-popover">
                        <p class="text-sm font-semibold text-highlighted">
                          กฎปิด ad group ของ order นี้
                        </p>
                        <div
                          class="flex flex-wrap items-center gap-1"
                          role="radiogroup"
                          aria-label="กฎปิด ad group ของ order นี้"
                          data-testid="la-adgroup-guard-mode"
                          :data-mode="guardDraftMode"
                        >
                          <UButton
                            v-for="mode in GUARD_MODES"
                            :key="mode"
                            :label="GUARD_POPOVER_MODE_LABEL[mode]"
                            :color="guardDraftMode === mode ? 'primary' : 'neutral'"
                            :variant="guardDraftMode === mode ? 'solid' : 'outline'"
                            size="xs"
                            role="radio"
                            :aria-checked="guardDraftMode === mode"
                            :data-testid="`la-adgroup-guard-mode-${mode}`"
                            @click="guardDraftMode = mode"
                          />
                        </div>
                        <AdGroupGuardRuleFields
                          v-if="guardDraftMode === 'custom'"
                          v-model="guardDraft"
                          testid="la-adgroup-guard"
                          :currency="guardCurrencies.length === 1 ? guardCurrencies[0]! : null"
                          @valid="guardDraftValid = $event"
                        />
                        <p v-else-if="guardDraftMode === 'inherit'" class="text-xs text-muted">
                          ใช้กฎที่ตั้งไว้ที่บัญชีหรือ workspace ของแต่ละบัญชี
                        </p>
                        <p v-else class="text-xs text-muted">
                          ไม่ปิด ad group อัตโนมัติใน order นี้
                        </p>
                        <div class="flex justify-end gap-2">
                          <UButton
                            label="ยกเลิก"
                            color="neutral"
                            variant="subtle"
                            size="sm"
                            data-testid="la-adgroup-guard-cancel"
                            @click="guardPopoverOpen = false"
                          />
                          <UButton
                            label="ใช้"
                            size="sm"
                            :disabled="!guardCanApply"
                            data-testid="la-adgroup-guard-apply"
                            @click="applyGuard"
                          />
                        </div>
                      </div>
                    </template>
                  </UPopover>
                </div>
                <span
                  v-if="guardMixedCurrency && laGuardMode === 'custom'"
                  class="text-warning"
                  data-testid="la-adgroup-guard-currency-warn"
                >บัญชีที่เลือกมีหลายสกุลเงิน — ตัวเลขจะถูกใช้ตามสกุลของแต่ละบัญชี</span>
                <span class="text-dimmed">ใช้กับ Create &amp; publish เท่านั้น</span>
              </div>

              <!--
                FEAT-062 — one DOM instance of the step actions (AS-2): the last block of the sticky aside at
                `lg+`, a fixed bottom bar below it. The page body carries `pb-20 lg:pb-0` for the bar.
              -->
              <div
                class="fixed inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-default
                  bg-default p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:static lg:z-auto lg:mt-auto
                  lg:bg-transparent lg:p-0 lg:pt-3"
                data-testid="la-actions"
              >
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
                    label="Create &amp; publish"
                    icon="i-lucide-rocket"
                    color="primary"
                    :disabled="!canSubmit || submitting"
                    :loading="submitting"
                    data-testid="la-publish"
                    @click="askPublish"
                  />
                </template>
              </div>
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
        :cbo="budgetIsCbo"
        :submitting="submitting"
        :pause-after-publish="pauseAfterPublish"
        :ad-group-guard-text="guardConfirmText"
        @confirm="confirmPublish"
      />
    </template>
  </UDashboardPanel>
</template>
