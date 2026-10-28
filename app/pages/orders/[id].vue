<script setup lang="ts">
/**
 * FEAT-016 — Order detail (functions 6.5, 6.6; api-contract.md **v1** `GET /campaign-orders/:id`,
 * `POST /campaign-orders/:id/cancel`, `POST /builds/:id/cancel`, `POST /builds/:id/stop-before-publish`;
 * spec AC-18). One `GET /backend/campaign-orders/<id>` per open, plus one every 5 s **only** while at least
 * one build is `queued` or `running` — `od-page[data-polling]` says whether the timer runs; it stops as soon
 * as no build is open any more and on leaving the page.
 *
 * The three actions share one confirm modal (`od-confirm` / `od-confirm-ok`) and each one is a single POST
 * whose 200 body is the same shape as the GET, so the page state is replaced from the answer (no extra
 * request on the happy path). A 409 shows the API text (it carries the current build status) and re-reads the
 * order, because the state the button was based on is stale by definition. 404 → `od-notfound`, 403 (a
 * Payment-only admin that typed the URL) → `od-forbidden` with the API text, no redirect.
 *
 * A build without `steps[]` shows `No steps yet` in its expanded row. FEAT-017 (AC-30): a step that carries a
 * `screenshotUrl` gets `od-step-shot`, and one click issues exactly one
 * `GET /backend/builds/:id/screenshots/:no` whose body becomes `od-shot-img` — the presigned `url` shape
 * (FEAT-048 api-contract.md v1 §3) directly, or the legacy `{ mimeType, base64 }` as a data URI
 * (`od-shot-loading` while it runs, `od-shot-error` with the API text on 404 / any failure). An `<img>` load
 * failure (expired/403 presigned URL) triggers exactly one refetch of the same endpoint (a fresh URL); a
 * second failure falls back to the same error alert.
 *
 * FEAT-020 (api-contract §6.4): the page gained two tabs. **Builds is unchanged** — same markup, same
 * testids, same 5 s poll, which keeps running whatever the open tab is. Report (`?tab=report`) mounts
 * `ReportsOrderReportPanel` on its first open and is then kept alive; that panel does its own single GET and
 * never polls.
 *
 * FEAT-046: the `Ad template` row of `od-summary` also shows the cover of the post the template is bound to
 * (`AdTemplatesPostCover`, FEAT-042). After the order's **first** GET (not the 5 s poll, not an action POST),
 * one `GET /ad-templates/<adTemplate.id>` (`retry: 0`) reads `postInfo`; `hasPostCover()` / `postInfoCheckedAt()`
 * decide whether the cover bytes are requested (`useCoverImage`, only while `postInfo.cover.ok === true`, so
 * this never produces an expected 404 of its own). `templateState` tracks the lookup: `gone` on 404 shows
 * `od-adt-gone`, any other failure shows `od-adt-cover-error` — both muted text under the name, no toast, no
 * retry loop. The order itself always renders from its own snapshot regardless of this lookup's outcome.
 *
 * FEAT-050 (spec "Order detail", AC-19): the summary gained the row `od-addon` — what the build will do about
 * the interactive add-on. The **values** come from the order's own snapshot (`adConfig.addOn`), because that is
 * what the build reads; an order saved **before** the feature has no such key at all and falls back to the
 * **current** template (already loaded above for the cover, so no extra request) with the suffix
 * `od-addon-from-template`. A snapshot that says `addOn: null`, a template that is gone or says `null`, and a
 * half-written blob (`readAdAddOn()` refuses it, like the API's `planAd()`) all render **no row**.
 * The **thumbnail** is one `GET /media/<imageId>` per resolved image id — triggered by the id, never by the 5 s
 * build poll or an action POST (both only replace the order, and the same id re-reads nothing). 404/410 →
 * placeholder + `od-addon-gone`, any other failure (including an `<img>` that will not load) → placeholder +
 * `od-addon-error`; no toast, no retry loop, and the row's text stays readable in every case.
 *
 * FEAT-055 (api-contract.md v1 §5; spec "UI behaviour", AC-16..20): a fourth `PendingAction` kind,
 * `retryBuild`, is a `failed`/`cancelled` build row's **Retry** button (`od-build-retry`) → the same confirm
 * modal, `POST /builds/:id/retry` through the existing `runAction()` → `apply(res)` path (one POST, same
 * `OrderDetailResponse` shape, 409 handled exactly like Cancel/Stop). The confirm description warns that a
 * draft from the earlier attempt may still be on TikTok, plus a publish-specific sentence for
 * `publishMode === 'publish'` orders. `od-build-attempt` (`attempt N`) appears next to the status badge only
 * when `attempt > 1`; `queuedAt` / `previousJobIds` are carried by `BuildView` but not rendered.
 *
 * FEAT-066 (api-contract.md v1 §3, spec "UI behaviour") — `od-pause-after-publish` (warning/outline/sm,
 * "ปิดหลังเผยแพร่") sits next to `od-mode` in the summary header, present iff `order.pauseAfterPublish`. Per
 * build row, next to `od-build-stop-requested`, `od-build-pause` (`data-state="<pause.state>"`, present iff
 * `build.pause` is non-null) uses `buildPauseBadge()` (`app/utils/campaign-orders.ts`) for its text/color —
 * `waitingKpi` รอปิด campaign (neutral) · `queued` กำลังปิด campaign… (warning) · `done` ปิด campaign แล้ว
 * (success) · `failed` ปิด campaign ไม่สำเร็จ (error, `title` = `pause.reason`); the expanded row
 * (`od-build-expanded`) repeats the reason as `od-build-pause-reason` when `failed`. No new request — the
 * page's existing 5 s poll (while a build is `queued`/`running`) keeps every badge current.
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdTemplate } from '#shared/types/ad-templates'
import type { MediaAssetView } from '#shared/types/media'
import { adAddOnSummaryText, readAdAddOn } from '~/utils/ad-add-on'
import { mediaSrc } from '~/utils/media'
import {
  type BuildConflictBody,
  type BuildScreenshotResponse,
  type BuildView,
  isBuildScreenshotUrl,
  type OrderDetail,
  type OrderDetailResponse
} from '#shared/types/campaign-orders'

const POLL_MS = 5000

const route = useRoute()
const router = useRouter()
const api = useApi()
const toast = useToast()

const orderId = computed(() => String(route.params.id ?? ''))

/** Full Spark post code from the order's stored ad config. Empty when this order did not authorize a post by code. */
const sparkPostCode = computed(() => {
  const post = order.value?.adConfig?.identity?.post
  if (!post || post.selection !== 'authCode' || !('code' in post) || typeof post.code !== 'string') return ''
  return post.code
})

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const order = ref<OrderDetail | null>(null)
const builds = ref<BuildView[]>([])
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
const notFound = ref<string | null>(null)
const actionError = ref<string | null>(null)
// bumped on every request so a late response (or a poll tick after unmount) is dropped
let session = 0

// FEAT-046 — the ad template's post cover (one GET per order open, never on a poll tick or action POST)
const template = ref<AdTemplate | null>(null)
const templateState = ref<'loading' | 'ready' | 'gone' | 'error'>('loading')
let loadedTemplateId: string | null = null
// bumped on every template id change so a late response of a superseded template is dropped
let templateSession = 0

useSeoMeta({ title: () => order.value?.name ?? 'Order' })

async function loadTemplate(id: string) {
  const s = ++templateSession
  template.value = null
  templateState.value = 'loading'
  try {
    // retry: 0 — exactly one request per order open, never repeated by the poll or an action
    const res = await api<AdTemplate>(`/ad-templates/${encodeURIComponent(id)}`, { retry: 0 })
    if (s !== templateSession) return
    template.value = res
    templateState.value = 'ready'
  } catch (e) {
    if (s !== templateSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    templateState.value = status === 404 ? 'gone' : 'error'
  }
}

// ── FEAT-050 — the add-on of this order (snapshot first, current template only for pre-feature orders) ───────────────
/** `true` only when the snapshot really carries the key: that is how a pre-feature order is recognised */
const snapshotHasAddOn = computed(() => {
  const snapshot = order.value?.adConfig
  return !!snapshot && typeof snapshot === 'object' && 'addOn' in snapshot
})

/** the add-on the build will fill, or `null` — the current template is consulted **only** for an old order */
const addOn = computed(() => {
  if (!order.value) return null
  if (snapshotHasAddOn.value) return readAdAddOn(order.value.adConfig.addOn)
  return readAdAddOn(template.value?.config?.addOn)
})

/** the row says where its values came from (spec: the suffix is only for the fallback) */
const addOnFromTemplate = computed(() => addOn.value !== null && !snapshotHasAddOn.value)

const addOnText = computed(() => (addOn.value ? adAddOnSummaryText(addOn.value) : ''))

/** one `GET /media/:id` per image id, never repeated by the poll or an action POST */
const addOnImage = ref<MediaAssetView | null>(null)
const addOnImageState = ref<'idle' | 'loading' | 'ready' | 'gone' | 'error'>('idle')
let loadedAddOnImageId: string | null = null
// bumped on every image change / unmount so a late response of a superseded id is dropped
let addOnImageSession = 0

const addOnImageSrc = computed(() => {
  const url = addOnImageState.value === 'ready' ? addOnImage.value?.url : null
  return url ? mediaSrc(url) : null
})

async function loadAddOnImage(id: string) {
  const s = ++addOnImageSession
  addOnImage.value = null
  addOnImageState.value = 'loading'
  try {
    // retry: 0 — exactly one request per image id
    const res = await api<MediaAssetView>(`/media/${encodeURIComponent(id)}`, { retry: 0 })
    if (s !== addOnImageSession) return
    addOnImage.value = res
    addOnImageState.value = 'ready'
  } catch (e) {
    if (s !== addOnImageSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    // the image was deleted from the library (the order keeps its snapshot) vs. anything else
    addOnImageState.value = status === 404 || status === 410 ? 'gone' : 'error'
  }
}

watch(() => addOn.value?.imageId ?? null, (id) => {
  if (!id) {
    addOnImageSession++
    loadedAddOnImageId = null
    addOnImage.value = null
    addOnImageState.value = 'idle'
    return
  }
  if (id === loadedAddOnImageId) return
  loadedAddOnImageId = id
  void loadAddOnImage(id)
}, { immediate: true })

/** an `<img>` that will not load (expired presigned URL) is "could not load", not "deleted"; no refetch loop */
function onAddOnImgError() {
  addOnImageState.value = 'error'
}

function apply(res: OrderDetailResponse) {
  order.value = res.order ?? null
  builds.value = res.builds ?? []
  loaded.value = true
  error.value = null
  forbidden.value = null
  notFound.value = null
  const templateId = order.value?.adTemplate?.id ?? null
  if (templateId && templateId !== loadedTemplateId) {
    loadedTemplateId = templateId
    void loadTemplate(templateId)
  }
}

/** `silent` = a poll tick or the refresh after an action: keep the page as it is while it runs */
async function load(silent = false) {
  const id = orderId.value
  if (!id) return
  const s = ++session
  if (!silent) pending.value = true
  try {
    // retry: 0 — exactly one request per open / tick / action
    const res = await api<OrderDetailResponse>(`/campaign-orders/${encodeURIComponent(id)}`, { retry: 0 })
    if (s !== session) return
    apply(res)
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    if (status === 404) {
      notFound.value = message
      order.value = null
      builds.value = []
      stopPolling()
    } else if (status === 403) {
      forbidden.value = message
      order.value = null
      builds.value = []
      stopPolling()
    } else if (silent) {
      // a failed poll tick must not wipe the page — say it once and keep polling
      toast.add({ title: 'Could not refresh the order', description: message, color: 'warning' })
    } else {
      error.value = message
    }
  } finally {
    if (s === session) pending.value = false
  }
}

// ── polling (only while a build is queued or running) ────────────────────────────────────────────────────────────────
const openBuilds = computed(() => builds.value.filter(b => b.status === 'queued' || b.status === 'running').length)
const polling = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

function stopPolling() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  polling.value = false
}

function startPolling() {
  if (timer) return
  polling.value = true
  timer = setInterval(() => {
    void load(true)
  }, POLL_MS)
}

watch(openBuilds, (count) => {
  if (count > 0) startPolling()
  else stopPolling()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
  templateSession++
  addOnImageSession++
  stopPolling()
})

// ── actions (one confirm modal for the three of them) ────────────────────────────────────────────────────────────────
type PendingAction
  = { kind: 'cancelOrder' }
    | { kind: 'cancelBuild', build: BuildView }
    | { kind: 'stopBuild', build: BuildView }
    | { kind: 'retryBuild', build: BuildView }

const action = ref<PendingAction | null>(null)
const confirmOpen = ref(false)
const acting = ref(false)

const confirmTitle = computed(() => {
  switch (action.value?.kind) {
    case 'cancelOrder': return 'Cancel every queued build of this order?'
    case 'cancelBuild': return 'Cancel this build?'
    case 'stopBuild': return 'Stop this build before it publishes?'
    case 'retryBuild': return 'Retry this build?'
    default: return 'Are you sure?'
  }
})

const confirmDescription = computed(() => {
  switch (action.value?.kind) {
    case 'cancelOrder':
      return `${order.value?.buildCounts?.queued ?? 0} queued build(s) are cancelled and removed from the queue. `
        + 'Builds that already run are not touched.'
    case 'cancelBuild':
      return 'The build is cancelled and its job is removed from the queue.'
    case 'stopBuild':
      return 'The build finishes filling everything in but never presses publish; it ends as ready.'
    case 'retryBuild': {
      const n = action.value.build.attempt + 1
      let text = `The same build runs again from the start (attempt ${n}). A draft from the earlier attempt may `
        + 'already exist on TikTok — it is not deleted; check and delete it yourself.'
      if (order.value?.publishMode === 'publish') {
        text += ' This order publishes: if the earlier attempt reached publish, a campaign may already be '
          + 'live — check Ads Manager before retrying.'
      }
      return text
    }
    default:
      return ''
  }
})

const confirmLabel = computed(() => {
  switch (action.value?.kind) {
    case 'stopBuild': return 'Stop before publish'
    case 'retryBuild': return 'Retry build'
    default: return 'Cancel build(s)'
  }
})

function ask(next: PendingAction) {
  action.value = next
  actionError.value = null
  confirmOpen.value = true
}

function askCancelOrder() {
  ask({ kind: 'cancelOrder' })
}

function askCancelBuild(build: BuildView) {
  ask({ kind: 'cancelBuild', build })
}

function askStopBuild(build: BuildView) {
  ask({ kind: 'stopBuild', build })
}

function askRetryBuild(build: BuildView) {
  ask({ kind: 'retryBuild', build })
}

function actionPath(current: PendingAction): string {
  if (current.kind === 'cancelOrder') return `/campaign-orders/${encodeURIComponent(orderId.value)}/cancel`
  const id = encodeURIComponent(current.build.id)
  if (current.kind === 'cancelBuild') return `/builds/${id}/cancel`
  if (current.kind === 'retryBuild') return `/builds/${id}/retry`
  return `/builds/${id}/stop-before-publish`
}

function successTitle(current: PendingAction): string {
  switch (current.kind) {
    case 'cancelOrder': return 'Order cancelled'
    case 'cancelBuild': return 'Build cancelled'
    case 'retryBuild': return 'Build retried'
    default: return 'Stop before publish requested'
  }
}

async function runAction() {
  const current = action.value
  if (!current || acting.value) return
  acting.value = true
  actionError.value = null
  try {
    // retry: 0 — exactly one POST per confirm; its 200 body is the fresh order + builds
    const res = await api<OrderDetailResponse>(actionPath(current), { method: 'POST', retry: 0 })
    session++
    apply(res)
    confirmOpen.value = false
    toast.add({ title: successTitle(current), description: order.value?.name, color: 'success' })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody & BuildConflictBody>>
    const status = err.response?.status ?? err.statusCode
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    const current409 = err.data?.status
    const text = status === 409 && current409 ? `${message} (now: ${buildStatusBadge(current409).label})` : message
    confirmOpen.value = false
    // the alert adds the build's current status; the toast keeps the API text verbatim
    actionError.value = text
    toast.add({ title: 'Action refused', description: message, color: status === 409 ? 'warning' : 'error' })
    // the state the button was based on is stale — read it again
    if (status === 409) void load(true)
  } finally {
    acting.value = false
  }
}

// ── build rows ───────────────────────────────────────────────────────────────────────────────────────────────────────
const expanded = ref<string[]>([])

function toggleExpanded(id: string) {
  expanded.value = expanded.value.includes(id)
    ? expanded.value.filter(x => x !== id)
    : [...expanded.value, id]
}

const canCancelOrder = computed(() => (order.value?.buildCounts?.queued ?? 0) > 0)

function canCancelBuild(build: BuildView): boolean {
  return build.status === 'queued'
}

function canStopBuild(build: BuildView): boolean {
  return build.status === 'running' && order.value?.publishMode === 'publish' && !build.stopBeforePublish
}

function canRetryBuild(build: BuildView): boolean {
  return build.status === 'failed' || build.status === 'cancelled'
}

// ── tabs (FEAT-020 api-contract §6.4) ────────────────────────────────────────────────────────────────────────────────
/** the open tab lives in the URL query (`?tab=report`), so a link can open the report directly */
type OrderTab = 'builds' | 'report'
const tab = computed<OrderTab>(() => (route.query.tab === 'report' ? 'report' : 'builds'))
/** the Report panel is created on the first open of the tab and then kept alive (one GET, not one per switch) */
const reportMounted = ref(false)
watch(tab, (value) => {
  if (value === 'report') reportMounted.value = true
}, { immediate: true })

function setTab(next: OrderTab) {
  const query = { ...route.query }
  if (next === 'report') query.tab = 'report'
  else delete query.tab
  void router.replace({ query })
}

// ── step screenshot (FEAT-017 AC-30 · api-contract §6) ───────────────────────────────────────────────────────────────
/**
 * One `GET /backend<step.screenshotUrl>` per click on `od-step-shot` (`screenshotUrl` is API-relative, so the
 * `useApi()` base `/backend` is the whole prefix). The 200 body is `{ mimeType, base64 }` → the image is rendered
 * from a data URI; a 404 (no screenshot / other workspace) or any other failure shows the API's `error` text
 * inside the modal. Closing it drops the image so the next click always fetches again.
 */
const screenshotOpen = ref(false)
const shotSrc = ref<string | null>(null)
const shotLoading = ref(false)
const shotError = ref<string | null>(null)
let shotSession = 0
/** the endpoint path of the open screenshot, kept so an `<img>` load failure can refetch it */
let shotUrl: string | null = null
/** one automatic refetch per click, triggered by `<img @error>`, not by the API call itself */
let shotImgRetried = false

async function openScreenshot(url: string) {
  const s = ++shotSession
  shotUrl = url
  shotSrc.value = null
  shotError.value = null
  shotLoading.value = true
  screenshotOpen.value = true
  try {
    // retry: 0 — exactly one request per click (or per `<img>` refetch)
    const res = await api<BuildScreenshotResponse>(url, { retry: 0 })
    if (s !== shotSession) return
    shotSrc.value = isBuildScreenshotUrl(res)
      ? res.url
      : (res.base64 ? `data:${res.mimeType};base64,${res.base64}` : null)
    if (!shotSrc.value) shotError.value = 'The screenshot came back empty'
  } catch (e) {
    if (s !== shotSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    shotError.value = err.data?.error ?? err.message ?? 'Unexpected error'
  } finally {
    if (s === shotSession) shotLoading.value = false
  }
}

/** the click handler (the request itself is awaited inside `openScreenshot`) */
function showScreenshot(url: string) {
  shotImgRetried = false
  void openScreenshot(url)
}

/** `<img>` failed to load the (possibly presigned) `src` — refetch the endpoint once for a fresh URL. */
function onShotImgError() {
  if (shotImgRetried || !shotUrl) {
    shotSrc.value = null
    shotError.value = 'Could not load the screenshot image'
    return
  }
  shotImgRetried = true
  void openScreenshot(shotUrl)
}

watch(screenshotOpen, (isOpen) => {
  if (isOpen) return
  // a request still in flight must not land in a closed modal
  shotSession++
  shotUrl = null
  shotImgRetried = false
  shotSrc.value = null
  shotError.value = null
  shotLoading.value = false
})

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const now = useNow({ interval: 30_000 })
function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}

/** deterministic local short datetime (`YYYY-MM-DD HH:mm`) */
function shortDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * The current (or last) step of a build. `stepCount` is the API's own number of recorded steps — the total
 * number of steps a build will have is not part of this contract, so the cell shows the name only and the
 * count lives on the expander (see "Contract questions" in bo.md).
 */
function stepCell(build: BuildView): string {
  return build.step ?? '—'
}

function stepCountOf(build: BuildView): number {
  return build.stepCount || build.steps.length
}

function stepsLabel(build: BuildView): string {
  const n = stepCountOf(build)
  return `${n} step${n === 1 ? '' : 's'}`
}

const budgetText = computed(() =>
  order.value?.budget ? formatBudgetAmount(order.value.budget.amount, order.value.budget) : '—'
)

/**
 * FEAT-061 (spec AC-21) — the campaign block of a **v3** snapshot (`adGroupConfig.campaign`): strategy,
 * campaign budget, bid strategy, target CPA and the campaign name. A v2 snapshot has no `campaign` key, so the
 * row is simply not rendered (`od-agc-campaign` exists only for v3) and nothing in here throws.
 * The four English words are page chrome, like the status labels of `utils/campaign-orders.ts` — this page
 * never loads the ad-group templates' `/options`.
 */
const CAMPAIGN_STRATEGY_TEXT: Record<string, string> = {
  cbo: 'CBO (campaign budget)',
  adGroup: 'Ad group budget'
}
const CAMPAIGN_BID_TEXT: Record<string, string> = {
  maxResults: 'Maximum results',
  costCap: 'Cost cap'
}

const campaignSnapshot = computed(() => {
  const campaign = order.value?.adGroupConfig?.campaign
  if (!campaign || typeof campaign !== 'object') return null
  const budget = campaign.budget ?? null
  const targetCpa = order.value?.adGroupConfig?.targetCpa
  const parts: string[] = [
    CAMPAIGN_STRATEGY_TEXT[campaign.budgetStrategy ?? ''] ?? String(campaign.budgetStrategy ?? '—')
  ]
  if (budget && Number.isFinite(budget.amount)) parts.push(formatBudgetAmount(budget.amount, budget))
  parts.push(CAMPAIGN_BID_TEXT[campaign.bidStrategy ?? ''] ?? String(campaign.bidStrategy ?? '—'))
  if (Number.isFinite(targetCpa)) {
    // `lifetime` only so the helper does not append " / day" — a target CPA is not a daily budget
    const currency = budget?.currency ?? order.value?.budget?.currency ?? 'THB'
    parts.push(`target CPA ${formatBudgetAmount(targetCpa as number, { type: 'lifetime', amount: 0, currency })}`)
  }
  return { text: parts.join(' · '), name: campaign.name ?? null }
})
/**
 * cap = budget × copies × builds (the build rows are the advertisers the order really runs on).
 * TASK-theme-cbo-cap — under CBO (`adGroupConfig.campaign.budgetStrategy`) the campaign budget is shared by the
 * copies, so it is `campaign.budget × builds` (`capBasis`); a v2 snapshot without `campaign` keeps the old product.
 */
const capText = computed(() => {
  const current = order.value
  if (!current) return '—'
  const source = { budget: current.budget, campaign: current.adGroupConfig?.campaign ?? null }
  return formatOrderCap(source, current.adGroupCopies, builds.value.length || current.targetCount)
})
const modalContent = { 'data-testid': 'od-confirm' } as Record<string, string>
const shotContent = { 'data-testid': 'od-shot' } as Record<string, string>
</script>

<template>
  <UDashboardPanel id="order-detail">
    <template #header>
      <UDashboardNavbar :title="order?.name ?? 'Order'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #trailing>
          <UBadge
            v-if="order"
            :color="orderStatusBadge(order.status).color"
            variant="subtle"
            class="whitespace-nowrap"
            data-testid="od-status"
          >
            {{ orderStatusBadge(order.status).label }}
          </UBadge>
        </template>

        <template #right>
          <UButton
            label="Back to orders"
            aria-label="Back to orders"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="outline"
            to="/orders"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="od-back"
          />
          <UButton
            v-if="canCancelOrder"
            label="Cancel order"
            aria-label="Cancel order"
            icon="i-lucide-circle-x"
            color="error"
            variant="subtle"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="od-cancel"
            @click="askCancelOrder"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="od-page"
        :data-polling="polling ? 'true' : 'false'"
        :data-pending="pending ? 'true' : 'false'"
        class="flex flex-1 flex-col gap-4"
      >
        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="You cannot access orders"
          :description="forbidden"
          data-testid="od-forbidden"
        />

        <UEmpty
          v-else-if="notFound"
          icon="i-lucide-file-question"
          title="Order not found"
          :description="notFound"
          data-testid="od-notfound"
        >
          <template #actions>
            <UButton
              label="Back to orders"
              icon="i-lucide-arrow-left"
              color="neutral"
              variant="outline"
              to="/orders"
              data-testid="od-notfound-back"
            />
          </template>
        </UEmpty>

        <UAlert
          v-else-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load the order"
          :description="error"
          data-testid="od-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              size="xs"
              :loading="pending"
              data-testid="od-retry"
              @click="load()"
            />
          </template>
        </UAlert>

        <p v-else-if="!loaded" class="text-sm text-muted" data-testid="od-loading">
          Loading order…
        </p>

        <template v-else-if="order">
          <UAlert
            v-if="actionError"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Action refused"
            :description="actionError"
            data-testid="od-action-error"
          />

          <!-- FEAT-020 — tabs around the untouched Builds content -->
          <div
            class="flex gap-1 border-b border-default"
            role="tablist"
            aria-label="Order tabs"
            data-testid="od-tabs"
          >
            <button
              type="button"
              role="tab"
              :aria-selected="tab === 'builds'"
              class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
              :class="tab === 'builds' ? 'border-primary text-highlighted' : 'border-transparent text-muted hover:text-default'"
              data-testid="od-tab-builds"
              @click="setTab('builds')"
            >
              Builds
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="tab === 'report'"
              class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
              :class="tab === 'report' ? 'border-primary text-highlighted' : 'border-transparent text-muted hover:text-default'"
              data-testid="od-tab-report"
              @click="setTab('report')"
            >
              Report
            </button>
          </div>

          <template v-if="tab === 'builds'">
            <!-- summary -->
            <section class="rounded-lg border border-default p-3" data-testid="od-summary">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-sm font-semibold text-highlighted">
                  Summary
                </h2>
                <UBadge
                  :color="order.publishMode === 'publish' ? 'warning' : 'neutral'"
                  variant="subtle"
                  class="whitespace-nowrap"
                  data-testid="od-mode"
                >
                  {{ order.publishMode === 'publish' ? 'Publish' : 'Draft' }}
                </UBadge>
                <!-- FEAT-066 — only when the order asked to be paused after publish -->
                <UBadge
                  v-if="order.pauseAfterPublish"
                  color="warning"
                  variant="outline"
                  size="sm"
                  class="whitespace-nowrap"
                  data-testid="od-pause-after-publish"
                >
                  ปิดหลังเผยแพร่
                </UBadge>
                <UBadge
                  color="neutral"
                  variant="outline"
                  class="whitespace-nowrap"
                  data-testid="od-workspace"
                >
                  {{ order.workspace?.name ?? '—' }}
                </UBadge>
              </div>
              <dl class="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <dt class="text-muted">
                  Campaign
                </dt>
                <dd class="text-highlighted" data-testid="od-preset">
                  Sales cashback → Website conversions
                </dd>
                <dt class="text-muted">
                  Ad group template
                </dt>
                <dd class="text-highlighted" data-testid="od-agt">
                  {{ order.adGroupTemplate?.name ?? '—' }}
                </dd>
                <!-- FEAT-061 — only a v3 snapshot carries a campaign section -->
                <template v-if="campaignSnapshot">
                  <dt class="text-muted">
                    Campaign
                  </dt>
                  <dd class="text-highlighted" data-testid="od-agc-campaign">
                    {{ campaignSnapshot.text }}
                    <span v-if="campaignSnapshot.name" class="text-muted" data-testid="od-agc-campaign-name">
                      · {{ campaignSnapshot.name }}
                    </span>
                  </dd>
                </template>
                <dt class="text-muted">
                  Budget per ad group
                </dt>
                <dd class="text-highlighted" data-testid="od-budget">
                  {{ budgetText }}
                </dd>
                <dt class="text-muted">
                  Ad group copies
                </dt>
                <dd class="text-highlighted" data-testid="od-copies">
                  {{ order.adGroupCopies }}
                </dd>
                <dt class="text-muted">
                  Ad template
                </dt>
                <dd class="flex items-start gap-3 text-highlighted">
                  <AdTemplatesPostCover
                    size="card"
                    testid="od-adt-cover"
                    :template-id="order.adTemplate?.id"
                    :checked-at="postInfoCheckedAt(template?.postInfo)"
                    :ok="hasPostCover(template?.postInfo)"
                  />
                  <div class="flex flex-col gap-0.5">
                    <span data-testid="od-adt">{{ order.adTemplate?.name ?? '—' }}</span>
                    <span v-if="templateState === 'gone'" class="text-xs text-muted" data-testid="od-adt-gone">
                      Template no longer exists
                    </span>
                    <span v-else-if="templateState === 'error'" class="text-xs text-muted" data-testid="od-adt-cover-error">
                      Cover unavailable
                    </span>
                  </div>
                </dd>
                <template v-if="sparkPostCode">
                  <dt class="text-muted">
                    Spark post code
                  </dt>
                  <dd class="break-all font-mono text-highlighted" data-testid="od-spark-code">
                    {{ sparkPostCode }}
                  </dd>
                </template>
                <!-- FEAT-050 — only rendered when an add-on was really found (snapshot, or the old-order fallback) -->
                <template v-if="addOn">
                  <dt class="text-muted">
                    Add-On
                  </dt>
                  <dd class="flex items-start gap-3 text-highlighted" data-testid="od-addon">
                    <img
                      v-if="addOnImageSrc"
                      :src="addOnImageSrc"
                      :alt="addOnImage?.name ?? ''"
                      class="h-12 w-auto max-w-20 rounded-md border border-default object-contain"
                      data-testid="od-addon-image"
                      @error="onAddOnImgError"
                    >
                    <div
                      v-else
                      class="flex h-12 w-20 shrink-0 items-center justify-center rounded-md border border-dashed border-default text-muted"
                      data-testid="od-addon-image-placeholder"
                    >
                      <UIcon name="i-lucide-image" class="size-4" />
                    </div>
                    <div class="flex min-w-0 flex-col gap-0.5">
                      <span class="flex flex-wrap items-baseline gap-1">
                        <span data-testid="od-addon-text">{{ addOnText }}</span>
                        <span
                          v-if="addOnFromTemplate"
                          class="text-xs text-muted"
                          data-testid="od-addon-from-template"
                        >(จาก template ปัจจุบัน)</span>
                      </span>
                      <span v-if="addOnImageState === 'gone'" class="text-xs text-muted" data-testid="od-addon-gone">
                        รูปถูกลบแล้ว
                      </span>
                      <span
                        v-else-if="addOnImageState === 'error'"
                        class="text-xs text-muted"
                        data-testid="od-addon-error"
                      >
                        โหลดรูปไม่ได้
                      </span>
                    </div>
                  </dd>
                </template>
                <dt class="text-muted">
                  Advertisers
                </dt>
                <dd class="text-highlighted" data-testid="od-targets">
                  {{ order.targetCount }}
                </dd>
                <template v-if="order.publishMode === 'publish'">
                  <dt class="text-muted">
                    Budget cap
                  </dt>
                  <dd class="font-medium text-highlighted" data-testid="od-cap">
                    {{ capText }}
                  </dd>
                </template>
                <dt class="text-muted">
                  Created
                </dt>
                <dd class="text-highlighted" data-testid="od-created">
                  {{ order.createdBy?.username ?? '—' }} · {{ shortDateTime(order.createdAt) }}
                </dd>
              </dl>
              <p class="mt-2 text-xs text-muted" data-testid="od-builds-summary">
                {{ buildSummaryText(order.buildCounts) }}
              </p>
            </section>

            <!-- builds -->
            <div class="overflow-x-auto" data-testid="od-builds-table">
              <table class="w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr class="bg-elevated/50">
                    <th class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Account
                    </th>
                    <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Advertiser
                    </th>
                    <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Status
                    </th>
                    <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Step
                    </th>
                    <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Started
                    </th>
                    <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Finished
                    </th>
                    <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Published
                    </th>
                    <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                      Error
                    </th>
                    <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <template v-for="build in builds" :key="build.id">
                    <!-- the whole row toggles its steps; the action buttons stop the click so they never expand it -->
                    <tr
                      :data-id="build.id"
                      :data-status="build.status"
                      data-slot="tr"
                      data-testid="od-build"
                      class="cursor-pointer"
                      @click="toggleExpanded(build.id)"
                    >
                      <td class="border-b border-default px-3 py-2">
                        <div class="flex flex-col">
                          <span class="font-medium text-highlighted">{{ build.account?.label ?? build.account?.loginEmail ?? '—' }}</span>
                          <span v-if="build.account?.label" class="text-xs text-muted">{{ build.account.loginEmail }}</span>
                        </div>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <div class="flex flex-col">
                          <span class="text-highlighted">{{ build.advertiser?.name ?? '—' }}</span>
                          <span v-if="build.advertiser" class="text-xs text-muted">{{ build.advertiser.tiktokAdvertiserId }}</span>
                        </div>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <div class="flex flex-col items-start gap-1">
                          <UBadge
                            :color="buildStatusBadge(build.status).color"
                            variant="subtle"
                            class="whitespace-nowrap"
                            data-testid="od-build-status"
                          >
                            {{ buildStatusBadge(build.status).label }}
                          </UBadge>
                          <UBadge
                            v-if="build.stopBeforePublish"
                            color="warning"
                            variant="outline"
                            size="sm"
                            class="whitespace-nowrap"
                            data-testid="od-build-stop-requested"
                          >
                            {{ build.stoppedBeforePublish ? 'Stopped before publish' : 'Stop requested' }}
                          </UBadge>
                          <!-- FEAT-066 — only while the build has a pause-after-publish state -->
                          <UBadge
                            v-if="build.pause"
                            :color="buildPauseBadge(build.pause.state).color"
                            variant="outline"
                            size="sm"
                            class="whitespace-nowrap"
                            data-testid="od-build-pause"
                            :data-state="build.pause.state"
                            :title="build.pause.state === 'failed' ? (build.pause.reason ?? undefined) : undefined"
                          >
                            {{ buildPauseBadge(build.pause.state).label }}
                          </UBadge>
                          <UBadge
                            v-if="build.attempt > 1"
                            color="neutral"
                            variant="outline"
                            size="sm"
                            class="whitespace-nowrap"
                            data-testid="od-build-attempt"
                          >
                            attempt {{ build.attempt }}
                          </UBadge>
                        </div>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <span data-testid="od-build-step">{{ stepCell(build) }}</span>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <div class="flex flex-col">
                          <span class="whitespace-nowrap" :title="build.startedAt ?? ''">{{ timeAgo(build.startedAt) }}</span>
                          <!-- FEAT-031: WORKER_INSTANCE that ran this build's job; absent when `workerInstance` is null -->
                          <span
                            v-if="typeof build.workerInstance === 'string'"
                            class="whitespace-nowrap text-xs text-muted"
                            data-testid="od-build-worker"
                            :data-instance="build.workerInstance"
                          >{{ build.workerInstance }}</span>
                        </div>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <span class="whitespace-nowrap" :title="build.finishedAt ?? ''">{{ timeAgo(build.finishedAt) }}</span>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <div class="flex flex-col">
                          <span class="whitespace-nowrap">{{ shortDateTime(build.publishedAt) }}</span>
                          <span v-if="build.tiktokCampaignId" class="text-xs text-muted">{{ build.tiktokCampaignId }}</span>
                        </div>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <span
                          v-if="build.lastError"
                          class="line-clamp-2 max-w-48 text-error"
                          :title="build.lastError"
                          data-testid="od-build-error"
                        >{{ build.lastError }}</span>
                        <span v-else class="text-muted">—</span>
                      </td>
                      <td class="border-b border-default px-3 py-2">
                        <div class="flex items-center justify-end gap-1 whitespace-nowrap">
                          <UButton
                            v-if="canCancelBuild(build)"
                            label="Cancel"
                            icon="i-lucide-circle-x"
                            color="error"
                            variant="subtle"
                            size="xs"
                            data-testid="od-build-cancel"
                            @click.stop="askCancelBuild(build)"
                          />
                          <UButton
                            v-if="canStopBuild(build)"
                            label="Stop before publish"
                            icon="i-lucide-hand"
                            color="warning"
                            variant="subtle"
                            size="xs"
                            data-testid="od-build-stop"
                            @click.stop="askStopBuild(build)"
                          />
                          <UButton
                            v-if="canRetryBuild(build)"
                            label="Retry"
                            icon="i-lucide-rotate-cw"
                            color="primary"
                            variant="subtle"
                            size="xs"
                            data-testid="od-build-retry"
                            @click.stop="askRetryBuild(build)"
                          />
                          <UButton
                            :icon="expanded.includes(build.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                            :label="stepsLabel(build)"
                            color="neutral"
                            variant="ghost"
                            size="xs"
                            data-testid="od-build-expand"
                            @click.stop="toggleExpanded(build.id)"
                          />
                        </div>
                      </td>
                    </tr>
                    <tr v-if="expanded.includes(build.id)" :data-id="build.id" data-testid="od-build-expanded">
                      <td class="border-b border-default bg-elevated/30 px-3 py-2" colspan="9">
                        <!-- FEAT-066 — the reason text of a failed pause, same place a failed step would show it -->
                        <p
                          v-if="build.pause?.state === 'failed'"
                          class="mb-2 text-sm text-error"
                          data-testid="od-build-pause-reason"
                        >
                          {{ build.pause.reason }}
                        </p>
                        <p v-if="build.steps.length === 0" class="text-sm text-muted" data-testid="od-steps-empty">
                          No steps yet
                        </p>
                        <ol v-else class="flex flex-col gap-1" data-testid="od-steps">
                          <li
                            v-for="stepEntry in build.steps"
                            :key="stepEntry.no"
                            :data-no="stepEntry.no"
                            :data-status="stepEntry.status"
                            data-testid="od-step"
                            class="flex flex-wrap items-center gap-2 text-sm"
                          >
                            <span class="w-6 text-right text-xs text-muted">{{ stepEntry.no }}</span>
                            <span class="font-medium text-highlighted">{{ stepEntry.name }}</span>
                            <UBadge
                              :color="stepEntry.status === 'failed' ? 'error' : stepEntry.status === 'done' ? 'success' : 'info'"
                              variant="subtle"
                              size="sm"
                              class="whitespace-nowrap"
                            >
                              {{ stepEntry.status }}
                            </UBadge>
                            <span v-if="stepEntry.message" class="text-xs text-muted">{{ stepEntry.message }}</span>
                            <span class="text-xs text-dimmed">{{ shortDateTime(stepEntry.at) }}</span>
                            <UButton
                              v-if="stepEntry.screenshotUrl"
                              label="Screenshot"
                              icon="i-lucide-image"
                              color="neutral"
                              variant="link"
                              size="xs"
                              data-testid="od-step-shot"
                              @click="showScreenshot(stepEntry.screenshotUrl)"
                            />
                          </li>
                        </ol>
                      </td>
                    </tr>
                  </template>
                </tbody>
              </table>
            </div>
          </template>

          <ReportsOrderReportPanel
            v-if="reportMounted"
            v-show="tab === 'report'"
            :order-id="orderId"
          />
        </template>
      </div>

      <UModal
        v-model:open="confirmOpen"
        :title="confirmTitle"
        :description="confirmDescription"
        :dismissible="!acting"
        :ui="{ content: 'max-w-md' }"
        :content="modalContent"
      >
        <template #body>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              label="Close"
              color="neutral"
              variant="subtle"
              :disabled="acting"
              data-testid="od-confirm-cancel"
              @click="confirmOpen = false"
            />
            <UButton
              :label="confirmLabel"
              :color="action?.kind === 'stopBuild' ? 'warning' : action?.kind === 'retryBuild' ? 'primary' : 'error'"
              :loading="acting"
              data-testid="od-confirm-ok"
              @click="runAction"
            />
          </div>
        </template>
      </UModal>

      <UModal
        v-model:open="screenshotOpen"
        title="Step screenshot"
        :ui="{ content: 'max-w-3xl' }"
        :content="shotContent"
      >
        <template #body>
          <div
            v-if="shotLoading"
            class="flex items-center gap-2 py-6 text-sm text-muted"
            data-testid="od-shot-loading"
          >
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            <span>Loading the screenshot…</span>
          </div>

          <UAlert
            v-else-if="shotError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="Could not load the screenshot"
            :description="shotError"
            role="alert"
            data-testid="od-shot-error"
          />

          <img
            v-else-if="shotSrc"
            :src="shotSrc"
            alt="Build step screenshot"
            class="w-full rounded-lg"
            data-testid="od-shot-img"
            @error="onShotImgError"
          >
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
