<script setup lang="ts">
/**
 * FEAT-069 — Reports → Dashboard (`/reports/dashboard`, test-id prefix `rd`; spec "UI behaviour →
 * /reports/dashboard", api-contract.md v1 §3 / §4 / §6). Round D1 of `_queue/dashboard-page.design.md`: what
 * the money turned into — Dep/Budget hero, the 8-step funnel, the daily / today-by-hour chart, delivery now and
 * two tables.
 *
 * Every load (URL change of `range/from/to/workspaceId`, the refresh button, the 5-minute tick) sends exactly
 * **two** requests — `GET /reports/dashboard` (range + workspace) and `GET /reports/dashboard/now` (workspace
 * only) — in parallel, under one session counter; `?chart=` is local. An invalid custom pair sends nothing.
 * A failure of either request shows `rd-error` (the content of the previous answer stays); a 403 on either
 * shows `rd-forbidden`.
 */
import type { DashboardChart, DashboardNowResponse, DashboardResponse } from '#shared/types/report-dashboard'

useSeoMeta({ title: 'Dashboard' })
definePageMeta({ path: '/reports/dashboard' })

const CHARTS: readonly DashboardChart[] = ['daily', 'hourly']
const LOAD_FALLBACK = 'โหลดรายงานไม่สำเร็จ'
const EMPTY_TEXT = 'ไม่มี spend และไม่มียอด UTM ในช่วงนี้ — ลองเลือกช่วงวันอื่น'
const NOTE_TEXT = 'spend หน่วยตามสกุลของ ad account ไม่แปลงค่า · วันของ spend ตัดตามเวลาของรอบ kpi ยอด UTM ตัดเวลาไทย · ยอด UTM ของ key ที่หลาย workspace ใช้ร่วมนับเต็มให้ทุก workspace'

const api = useApi()
const scope = useReportScopeState({ key: 'chart', values: CHARTS, fallback: 'daily' })
const { isGod, rangeState, rangeInvalid, workspaceId } = scope

const report = ref<DashboardResponse | null>(null)
const nowState = ref<DashboardNowResponse | null>(null)
const pending = ref(true)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
const workspaces = ref<DashboardResponse['scope']['workspaces']>([])
let session = 0

async function load() {
  if (rangeInvalid.value) {
    session++
    pending.value = false
    return
  }
  const s = ++session
  pending.value = true
  const query = scope.requestQuery.value
  const [main, live] = await Promise.allSettled([
    api<DashboardResponse>('/reports/dashboard', { retry: 0, query }),
    api<DashboardNowResponse>('/reports/dashboard/now', {
      retry: 0,
      query: workspaceId.value ? { workspaceId: workspaceId.value } : {}
    })
  ])
  if (s !== session) return
  pending.value = false
  const failures = [main, live].filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map(r => reportFailure(r.reason, LOAD_FALLBACK))
  const denied = failures.find(f => f.status === 403)
  if (denied) {
    forbidden.value = denied.message
    error.value = null
    report.value = null
    nowState.value = null
    return
  }
  forbidden.value = null
  if (main.status === 'fulfilled') {
    report.value = main.value
    workspaces.value = main.value.scope.workspaces
  }
  if (live.status === 'fulfilled') nowState.value = live.value
  error.value = failures[0]?.message ?? null
  if (failures.length === 0) auto.markLoaded()
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

const ready = computed(() => report.value !== null && nowState.value !== null)
const showSkeleton = computed(() => pending.value && !ready.value && !error.value && !forbidden.value)
const isEmpty = computed(() => {
  const f = report.value?.funnel
  return !!f && !f.metrics.spend && !f.utm.registers && !f.utm.depositors && !f.utm.depositAmount
})
const pageState = computed(() => {
  if (forbidden.value) return 'forbidden'
  if (error.value && !ready.value) return 'error'
  if (showSkeleton.value) return 'loading'
  if (isEmpty.value) return 'empty'
  return 'ready'
})
</script>

<template>
  <UDashboardPanel id="report-dashboard">
    <template #header>
      <UDashboardNavbar title="Dashboard">
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
            data-testid="rd-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rd-page"
        :data-state="pageState"
        :data-range="rangeState.range"
        :data-pending="pending ? 'true' : 'false'"
        class="flex min-w-0 flex-1 flex-col gap-5"
      >
        <ReportPerformanceToolbar
          prefix="rd"
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
          data-testid="rd-forbidden"
        />

        <template v-else>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="rd-error"
          >
            <template #actions>
              <UButton
                label="ลองใหม่"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rd-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <div v-if="showSkeleton" class="flex flex-col gap-3" data-testid="rd-loading">
            <USkeleton class="h-28 w-full" />
            <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <USkeleton v-for="i in 8" :key="i" class="h-20" />
            </div>
            <USkeleton class="h-72 w-full" />
          </div>

          <div
            v-else-if="report && nowState"
            class="flex min-w-0 flex-col gap-5 transition-opacity"
            :class="pending ? 'opacity-70' : ''"
            data-testid="rd-content"
          >
            <p
              v-if="isEmpty"
              class="rounded-lg border border-dashed border-default p-3 text-sm text-muted"
              data-testid="rd-empty"
            >
              {{ EMPTY_TEXT }}
            </p>

            <ReportDashboardFunnelSection :funnel="report.funnel" :previous="report.previousFunnel" />

            <ReportDashboardChartCard
              :chart="scope.extraValue.value"
              :daily="report.daily"
              :hourly="report.hourly"
              @chart="scope.setExtra"
            />

            <ReportDashboardDeliveryBlock :now="nowState" />

            <section v-if="isGod" class="flex min-w-0 flex-col gap-2">
              <h2 class="text-sm font-semibold text-highlighted">
                แยกตาม workspace
              </h2>
              <ReportDashboardWorkspaceTable
                :rows="report.byWorkspace"
                :funnel="report.funnel"
                :now="{ accounts: nowState.accounts.total, launching: nowState.launching.total, banned: nowState.banned.now }"
                @pick="scope.onWorkspace"
              />
            </section>

            <section class="flex min-w-0 flex-col gap-2">
              <h2 class="text-sm font-semibold text-highlighted">
                แยกตามบัญชี
              </h2>
              <ReportDashboardAccountTable :rows="report.byAccount" :is-god="isGod" />
            </section>

            <p class="text-xs text-muted" data-testid="rd-note">
              {{ NOTE_TEXT }}
            </p>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
