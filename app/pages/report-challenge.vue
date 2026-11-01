<script setup lang="ts">
/**
 * FEAT-094 — Reports → Challenge (`/reports/challenge`, test-id prefix `rc`; spec "UI behaviour →
 * /reports/challenge", api-contract.md v1 §2 + §4). Every admin and GOD sees one card per workspace owner,
 * ranked by "คุ้ม" (Dep/Budget %) or "ได้ยอดมากสุด" (deposit), with a "my rank" band on top and a detail panel
 * for the selected person's launching advertisers and top 3 ads.
 *
 * **The URL is the state**: `range/from/to` (FEAT-065 helpers) drive the single `GET /reports/challenge`
 * request (`retry: 0`, a session counter drops a superseded answer, `workspaceId` is **never** sent — the API
 * is strict and has no such field, A1); `by` and `admin` are view-only query keys the page never requests on.
 * The page also refreshes itself every 5 minutes while the tab is visible (`useReportAutoRefresh`).
 */
import type { ChallengeBy, ChallengeResponse } from '#shared/types/report-challenge'

useSeoMeta({ title: 'Challenge' })
definePageMeta({ path: '/reports/challenge' })

const BY_VALUES = ['depBudget', 'deposit'] as const
const BY_LABEL: Record<ChallengeBy, string> = {
  depBudget: 'คุ้ม (ได้ยอด ÷ ยิงไป)',
  deposit: 'ได้ยอดมากสุด'
}
const LOAD_FALLBACK = 'โหลดรายงานไม่สำเร็จ'

const api = useApi()
const route = useRoute()
const scope = useReportScopeState({ key: 'by', values: BY_VALUES, fallback: 'depBudget' })
const { rangeState, rangeInvalid } = scope
const by = computed<ChallengeBy>(() => scope.extraValue.value)

const adminParam = computed(() => {
  const raw = route.query.admin
  return typeof raw === 'string' && raw !== '' ? raw : ''
})

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const report = ref<ChallengeResponse | null>(null)
const pending = ref(true)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
let session = 0

async function load() {
  if (rangeInvalid.value) {
    session++
    pending.value = false
    return
  }
  const s = ++session
  pending.value = true
  try {
    // never send `workspaceId` — the API is strict and has no such field (contract §2, spec A1)
    const res = await api<ChallengeResponse>('/reports/challenge', { retry: 0, query: reportRangeQuery(rangeState.value) })
    if (s !== session) return
    report.value = res
    error.value = null
    forbidden.value = null
    auto.markLoaded()
  } catch (e) {
    if (s !== session) return
    const { status, message } = reportFailure(e, LOAD_FALLBACK)
    if (status === 403) {
      forbidden.value = message
      error.value = null
      report.value = null
    } else {
      forbidden.value = null
      error.value = message
    }
  } finally {
    if (s === session) pending.value = false
  }
}

const auto = useReportAutoRefresh(load)

/** only the range re-triggers a request — `by` / `admin` are local URL state */
const loadKey = computed(() => JSON.stringify([rangeState.value.range, rangeState.value.from, rangeState.value.to]))
watch(loadKey, () => {
  void load()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

// ── ranking / selection (BO-side, app/utils/report-challenge.ts) ───────────────────────────────────────────────────────
const ranked = computed(() => (report.value ? rankPeople(report.value.people, by.value) : []))
const rankedByAdmin = computed(() => new Map(ranked.value.map(r => [r.person.admin.id, r] as const)))
const rankedCount = computed(() => ranked.value.filter(r => r.rank !== null).length)
const rankOne = computed(() => ranked.value.find(r => r.rank === 1) ?? null)
const rankTwo = computed(() => ranked.value.find(r => r.rank === 2) ?? null)

const meAdminId = computed(() => report.value?.me.adminId ?? null)
const mePerson = computed(() => {
  if (!meAdminId.value || !report.value) return null
  return report.value.people.find(p => p.admin.id === meAdminId.value) ?? null
})
const meEntry = computed(() => (mePerson.value ? rankedByAdmin.value.get(mePerson.value.admin.id) ?? null : null))

const selectedAdminId = computed(() => {
  const raw = adminParam.value
  if (raw && rankedByAdmin.value.has(raw)) return raw
  if (rankOne.value) return rankOne.value.person.admin.id
  return ranked.value[0]?.person.admin.id ?? null
})
const selectedEntry = computed(() => (selectedAdminId.value ? rankedByAdmin.value.get(selectedAdminId.value) ?? null : null))

function selectAdmin(id: string) {
  const rank1Id = rankOne.value?.person.admin.id
  scope.setQuery({ admin: id === rank1Id ? undefined : id })
}

// ── page state ───────────────────────────────────────────────────────────────────────────────────────────────────────
const showSkeleton = computed(() => pending.value && !report.value && !error.value && !forbidden.value)
const isEmpty = computed(() => {
  const r = report.value
  if (!r) return false
  if (r.people.length === 0) return true
  return r.people.every(p => p.spend === 0 && p.deposit === 0)
})
const pageState = computed(() => {
  if (forbidden.value) return 'forbidden'
  if (error.value && !report.value) return 'error'
  if (showSkeleton.value) return 'loading'
  if (report.value && isEmpty.value) return 'empty'
  return 'ready'
})
</script>

<template>
  <UDashboardPanel id="report-challenge">
    <template #header>
      <UDashboardNavbar title="ใครยิงดีสุด">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            label="รีเฟรช"
            aria-label="รีเฟรช"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="rc-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rc-page"
        :data-state="pageState"
        :data-range="rangeState.range"
        :data-pending="pending ? 'true' : 'false'"
        class="flex min-w-0 flex-1 flex-col gap-5"
      >
        <div class="flex flex-wrap items-center gap-2">
          <ReportsDateRange
            prefix="rc"
            :range="rangeState.range"
            :from="rangeState.from"
            :to="rangeState.to"
            :pending="pending"
            @update="scope.onRange"
          />

          <div data-testid="rc-by" class="flex gap-1">
            <UButton
              v-for="key in BY_VALUES"
              :key="key"
              :label="BY_LABEL[key]"
              size="xs"
              :color="by === key ? 'primary' : 'neutral'"
              :variant="by === key ? 'solid' : 'outline'"
              :aria-pressed="by === key"
              :data-testid="`rc-by-${key}`"
              @click="scope.setExtra(key)"
            />
          </div>

          <p class="flex items-center gap-1.5 text-xs text-muted" data-testid="rc-updated" :data-loading="pending ? 'true' : 'false'">
            <span class="size-2 shrink-0 rounded-full" :class="pending ? 'animate-pulse bg-primary' : 'bg-success'" aria-hidden="true" />
            <span>{{ perfUpdatedText(auto.lastLoadedAt.value) }}</span>
          </p>
        </div>

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="forbidden"
          data-testid="rc-forbidden"
        />

        <template v-else>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="rc-error"
          >
            <template #actions>
              <UButton
                label="ลองใหม่"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rc-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <div v-if="showSkeleton" class="flex flex-col gap-3" data-testid="rc-loading">
            <USkeleton class="h-16 w-full" />
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <USkeleton v-for="i in 3" :key="i" class="h-64" />
            </div>
            <USkeleton class="h-48 w-full" />
          </div>

          <div
            v-else-if="report"
            class="flex min-w-0 flex-col gap-5 transition-opacity"
            :class="pending ? 'opacity-70' : ''"
            data-testid="rc-content"
          >
            <p
              v-if="isEmpty"
              class="rounded-lg border border-dashed border-default p-3 text-sm text-muted"
              data-testid="rc-empty"
            >
              ยังไม่มีใครยิงในช่วงนี้
            </p>

            <ReportChallengeMeLine
              :me-admin-id="meAdminId"
              :me-person="mePerson"
              :me-rank="meEntry?.rank ?? null"
              :ranked-count="rankedCount"
              :rank-one="rankOne"
              :rank-two="rankTwo"
              :by="by"
              :team="report.team"
            />

            <div data-testid="rc-grid" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReportChallengePersonCard
                v-for="entry in ranked"
                :key="entry.person.admin.id"
                :person="entry.person"
                :rank="entry.rank"
                :value="entry.value"
                :by="by"
                :is-me="entry.person.admin.id === meAdminId"
                :selected="entry.person.admin.id === selectedAdminId"
                :range-key="rangeState.range"
                @select="selectAdmin"
              />
            </div>

            <ReportChallengeDetailPanel
              :person="selectedEntry?.person ?? null"
              :rank="selectedEntry?.rank ?? null"
            />

            <ReportChallengeNotes :fx="report.fx" />
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
