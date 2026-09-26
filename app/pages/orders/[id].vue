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
 * Builds have no `steps[]` yet (the build worker is not part of this feature) → the expanded row shows
 * `No steps yet`; a step that carries a screenshot opens it in a modal.
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  BuildConflictBody,
  BuildView,
  OrderDetail,
  OrderDetailResponse
} from '#shared/types/campaign-orders'

const POLL_MS = 5000

const route = useRoute()
const api = useApi()
const toast = useToast()

const orderId = computed(() => String(route.params.id ?? ''))

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

useSeoMeta({ title: () => order.value?.name ?? 'Order' })

function apply(res: OrderDetailResponse) {
  order.value = res.order ?? null
  builds.value = res.builds ?? []
  loaded.value = true
  error.value = null
  forbidden.value = null
  notFound.value = null
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
  stopPolling()
})

// ── actions (one confirm modal for the three of them) ────────────────────────────────────────────────────────────────
type PendingAction
  = { kind: 'cancelOrder' }
    | { kind: 'cancelBuild', build: BuildView }
    | { kind: 'stopBuild', build: BuildView }

const action = ref<PendingAction | null>(null)
const confirmOpen = ref(false)
const acting = ref(false)

const confirmTitle = computed(() => {
  switch (action.value?.kind) {
    case 'cancelOrder': return 'Cancel every queued build of this order?'
    case 'cancelBuild': return 'Cancel this build?'
    case 'stopBuild': return 'Stop this build before it publishes?'
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
    default:
      return ''
  }
})

const confirmLabel = computed(() => (action.value?.kind === 'stopBuild' ? 'Stop before publish' : 'Cancel build(s)'))

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

function actionPath(current: PendingAction): string {
  if (current.kind === 'cancelOrder') return `/campaign-orders/${encodeURIComponent(orderId.value)}/cancel`
  const id = encodeURIComponent(current.build.id)
  return current.kind === 'cancelBuild' ? `/builds/${id}/cancel` : `/builds/${id}/stop-before-publish`
}

function successTitle(current: PendingAction): string {
  switch (current.kind) {
    case 'cancelOrder': return 'Order cancelled'
    case 'cancelBuild': return 'Build cancelled'
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
    actionError.value = text
    toast.add({ title: 'Action refused', description: text, color: status === 409 ? 'warning' : 'error' })
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

const screenshot = ref<string | null>(null)
const screenshotOpen = ref(false)

function openScreenshot(url: string) {
  screenshot.value = url
  screenshotOpen.value = true
}

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
const capText = computed(() =>
  order.value ? formatBudgetCap(order.value.budget, order.value.adGroupCopies, order.value.targetCount) : '—'
)
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
                Sales · cashback offer → website conversions
              </dd>
              <dt class="text-muted">
                Ad group template
              </dt>
              <dd class="text-highlighted" data-testid="od-agt">
                {{ order.adGroupTemplate?.name ?? '—' }}
              </dd>
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
              <dd class="text-highlighted" data-testid="od-adt">
                {{ order.adTemplate?.name ?? '—' }}
              </dd>
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
                  <tr
                    :data-id="build.id"
                    :data-status="build.status"
                    data-slot="tr"
                    data-testid="od-build"
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
                      </div>
                    </td>
                    <td class="border-b border-default px-3 py-2">
                      <span data-testid="od-build-step">{{ stepCell(build) }}</span>
                    </td>
                    <td class="border-b border-default px-3 py-2">
                      <span class="whitespace-nowrap" :title="build.startedAt ?? ''">{{ timeAgo(build.startedAt) }}</span>
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
                          @click="askCancelBuild(build)"
                        />
                        <UButton
                          v-if="canStopBuild(build)"
                          label="Stop before publish"
                          icon="i-lucide-hand"
                          color="warning"
                          variant="subtle"
                          size="xs"
                          data-testid="od-build-stop"
                          @click="askStopBuild(build)"
                        />
                        <UButton
                          :icon="expanded.includes(build.id) ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
                          :label="stepsLabel(build)"
                          color="neutral"
                          variant="ghost"
                          size="xs"
                          data-testid="od-build-expand"
                          @click="toggleExpanded(build.id)"
                        />
                      </div>
                    </td>
                  </tr>
                  <tr v-if="expanded.includes(build.id)" :data-id="build.id" data-testid="od-build-expanded">
                    <td class="border-b border-default bg-elevated/30 px-3 py-2" colspan="9">
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
                            @click="openScreenshot(stepEntry.screenshotUrl)"
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
              :color="action?.kind === 'stopBuild' ? 'warning' : 'error'"
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
          <img
            v-if="screenshot"
            :src="screenshot"
            alt="Build step screenshot"
            class="w-full rounded-lg"
          >
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
