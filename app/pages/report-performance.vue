<script setup lang="ts">
/**
 * FEAT-069 — Reports → Performance (`/reports/performance`, test-id prefix `rf`; spec "UI behaviour →
 * /reports/performance", api-contract.md v1 §2 + §6). The apollo port of to-the-mars' "My/Team Performance":
 * results of the range, the five value ratios, the range-independent "ตอนนี้" block and four tabs.
 *
 * A separate page file with `definePageMeta({ path })` like `report-utm.vue` (a file under `pages/reports/`
 * would become a child of `reports.vue`, which has no `<NuxtPage>`).
 *
 * **The URL is the state** (`range/from/to/workspaceId/tab`): a range or workspace change = exactly one
 * `GET /reports/performance` (`retry: 0`, a session counter drops a superseded answer); a tab change is local.
 * An invalid custom pair sends nothing. The page also refreshes itself every 5 minutes while the tab is visible
 * (`useReportAutoRefresh`, decision 2 of the human) — the content stays on screen, dimmed, during a refresh.
 */
import type { PerformanceResponse, PerfTab } from '#shared/types/report-performance'

useSeoMeta({ title: 'Performance' })
definePageMeta({ path: '/reports/performance' })

const TABS: readonly PerfTab[] = ['day', 'workspace', 'utm', 'account']
const TAB_LABEL: Record<PerfTab, string> = {
  day: 'รายวัน',
  workspace: 'แยกตาม workspace',
  utm: 'แยกตาม UTM',
  account: 'แยกตามบัญชี'
}
const TAB_NOTE: Record<PerfTab, string> = {
  day: 'Spend และ advertiser ที่ใช้นับจากยอดรวมต่อวันของ advertiser · ถูกระงับ = วันที่รอบ kpi เห็น ไม่ใช่วันที่ TikTok ระงับจริง · Runs = build ที่สั่งในวันนั้น แสดงผลตอนนี้',
  workspace: 'ยอดสมัคร/ฝากของ UTM ที่หลาย workspace ใช้ร่วมกัน นับเต็มให้ทุก workspace · แถวรวมนับ UTM ครั้งเดียว · spend เป็น THB · ยอดเป็นของ workspace ปัจจุบันของ advertiser',
  utm: 'ยอดสมัคร/ฝากนับเต็มของ UTM นั้น · Spend คือค่าโฆษณาของทุก ads ที่ใช้ UTM นี้ (ทุก workspace) เป็น THB · "—" คือ UTM ที่ยังไม่มี ads จากระบบ',
  account: 'Spend ของ advertiser ในช่วงที่เลือก เป็น THB · สถานะเป็นสถานะตอนนี้'
}
const LOAD_FALLBACK = 'โหลดรายงานไม่สำเร็จ'
const EMPTY_TEXT = 'ไม่มี spend และไม่มียอด UTM ในช่วงนี้ — ลองเลือกช่วงวันอื่น'

const api = useApi()
const scope = useReportScopeState({ key: 'tab', values: TABS, fallback: 'day' })
const { isGod, rangeState, rangeInvalid, workspaceId } = scope

/** the workspace tab is GOD only; an Admin's `?tab=workspace` falls back to `day` */
const tabs = computed(() => TABS.filter(t => t !== 'workspace' || isGod.value))
const tab = computed<PerfTab>(() => (tabs.value.includes(scope.extraValue.value) ? scope.extraValue.value : 'day'))

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const report = ref<PerformanceResponse | null>(null)
const pending = ref(true)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
/** the workspace list survives a reload so the picker never empties */
const workspaces = ref<PerformanceResponse['scope']['workspaces']>([])
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
    const res = await api<PerformanceResponse>('/reports/performance', { retry: 0, query: scope.requestQuery.value })
    if (s !== session) return
    report.value = res
    workspaces.value = res.scope.workspaces
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

watch(scope.loadKey, () => {
  void load()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

// ── derived ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const isAll = computed(() => report.value?.range.key === 'all')
const singleDay = computed(() => {
  const r = report.value?.range
  return !!r && r.from !== null && r.from === r.to
})
const isEmpty = computed(() => {
  const r = report.value?.results
  return !!r && !r.spend && !r.utm.registers && !r.utm.depositors && !r.utm.depositAmount
})
const showSkeleton = computed(() => pending.value && !report.value && !error.value && !forbidden.value)
const pageState = computed(() => {
  if (forbidden.value) return 'forbidden'
  if (error.value && !report.value) return 'error'
  if (showSkeleton.value) return 'loading'
  if (isEmpty.value) return 'empty'
  return 'ready'
})
const scopeIds = computed(() => workspaceId.value
  ? [workspaceId.value]
  : (report.value?.scope.workspaces ?? []).map(ws => ws.id))
const today = bangkokToday()
</script>

<template>
  <UDashboardPanel id="report-performance">
    <template #header>
      <UDashboardNavbar title="Performance">
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
            data-testid="rf-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rf-page"
        :data-state="pageState"
        :data-range="rangeState.range"
        :data-pending="pending ? 'true' : 'false'"
        class="flex min-w-0 flex-1 flex-col gap-5"
      >
        <ReportPerformanceToolbar
          prefix="rf"
          :range="rangeState"
          :pending="pending"
          :is-god="isGod"
          :workspaces="workspaces"
          :workspace-id="workspaceId"
          :last-loaded-at="auto.lastLoadedAt.value"
          @range="scope.onRange"
          @workspace="scope.onWorkspace"
        />

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="forbidden"
          data-testid="rf-forbidden"
        />

        <template v-else>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="rf-error"
          >
            <template #actions>
              <UButton
                label="ลองใหม่"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rf-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <div v-if="showSkeleton" class="flex flex-col gap-3" data-testid="rf-loading">
            <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <USkeleton class="col-span-2 h-40 lg:row-span-2" />
              <USkeleton class="h-20" />
              <USkeleton class="h-20" />
              <USkeleton class="h-20" />
              <USkeleton class="h-20" />
            </div>
            <USkeleton class="h-20 w-full" />
            <USkeleton class="h-64 w-full" />
          </div>

          <div
            v-else-if="report"
            class="flex min-w-0 flex-col gap-5 transition-opacity"
            :class="pending ? 'opacity-70' : ''"
            data-testid="rf-content"
          >
            <p
              v-if="isEmpty"
              class="rounded-lg border border-dashed border-default p-3 text-sm text-muted"
              data-testid="rf-empty"
            >
              {{ EMPTY_TEXT }}
            </p>

            <MoneyNote mode="thb" :fx="report.fx" class="self-start" />

            <ReportPerformanceResultsSection
              :fx="report.fx"
              :results="report.results"
              :previous="report.previousResults"
              :trend="report.trend"
              :single-day="singleDay"
            />

            <ReportPerformanceNowBlock :now="report.now" />

            <section class="flex min-w-0 flex-col gap-2">
              <div
                role="tablist"
                aria-label="ตาราง"
                class="flex flex-wrap gap-1"
                data-testid="rf-tabs"
                :data-tab="tab"
              >
                <UButton
                  v-for="t in tabs"
                  :key="t"
                  role="tab"
                  :aria-selected="tab === t"
                  :label="TAB_LABEL[t]"
                  size="sm"
                  :color="tab === t ? 'primary' : 'neutral'"
                  :variant="tab === t ? 'soft' : 'ghost'"
                  :data-testid="`rf-tab-${t}`"
                  @click="scope.setExtra(t)"
                />
              </div>

              <ReportPerformanceDayTable
                v-if="tab === 'day'"
                :rows="report.byDay"
                :is-all="isAll"
                :used-total="report.results.usedAdvertisers"
                :today="today"
              />
              <ReportPerformanceWorkspaceTable
                v-else-if="tab === 'workspace'"
                :rows="report.byWorkspace"
                :results="report.results"
                :now="report.now"
                @pick="scope.onWorkspace"
              />
              <ReportPerformanceUtmTable
                v-else-if="tab === 'utm'"
                :rows="report.byUtm"
                :range="rangeState"
                :scope-ids="scopeIds"
              />
              <ReportPerformanceAccountTable
                v-else
                :rows="report.byAccount"
                :is-god="isGod"
              />

              <p class="text-xs text-muted" data-testid="rf-tab-note">
                {{ TAB_NOTE[tab] }}
              </p>
            </section>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
