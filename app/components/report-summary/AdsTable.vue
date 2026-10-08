<script setup lang="ts">
/**
 * FEAT-035 — table 2 of `/reports/summary` (api-contract.md §3 `rs-ads`): one row per ad from
 * `GET /reports/ads` (`limit=50`), paginated and sorted **server-side** (AS-9 — unlike table 1, which holds
 * the whole grouped set on the client). Rows are deliberately not clickable: the ad slideover stays on
 * `/reports` (AS-8); this page only links out to the order and, via the account/advertiser name in table 1,
 * to a filtered `/reports`.
 *
 * No balance anywhere, even if a stubbed row carries the FEAT-029 balance keys on `advertiser` — that cell
 * is owned by FEAT-034 and this table never reads it (contract §3, spec "No balance anywhere", AC-17).
 * The footer is always the response's `totals` (the whole filter), never the sum of the visible page.
 */
import type { AdReportRow, KpiMetrics, ReportSortField } from '#shared/types/reports'

/** the metric fields of `KpiMetrics` only — `ReportSortField` also carries `creativeName`/`lastSeenAt` */
type AdsMetricField = Exclude<ReportSortField, 'creativeName' | 'lastSeenAt'>

const props = withDefaults(defineProps<{
  rows: AdReportRow[]
  total: number
  totals: KpiMetrics | null
  /** e.g. `-spend` */
  sort: string
  page: number
  limit: number
  pending?: boolean
}>(), {
  pending: false
})

const emit = defineEmits<{
  'update:sort': [value: string]
  'update:page': [value: number]
}>()

const METRIC_COLUMNS: { field: AdsMetricField, label: string, format: 'int' | 'dec' | 'pct' }[] = [
  { field: 'spend', label: 'Spend', format: 'dec' },
  { field: 'impressions', label: 'Impr.', format: 'int' },
  { field: 'clicks', label: 'Clicks', format: 'int' },
  { field: 'ctr', label: 'CTR', format: 'pct' },
  { field: 'cpc', label: 'CPC', format: 'dec' },
  { field: 'conversions', label: 'Conv.', format: 'int' },
  { field: 'conversionCost', label: 'CPA', format: 'dec' }
]

const sortField = computed<string>(() => props.sort.replace(/^-/, ''))
const sortDesc = computed(() => props.sort.startsWith('-'))

function ariaSort(field: ReportSortField): 'ascending' | 'descending' | 'none' {
  if (sortField.value !== field) return 'none'
  return sortDesc.value ? 'descending' : 'ascending'
}

/** first click on a new column = descending for every metric, ascending for the name (creativeName) */
function toggleSort(field: ReportSortField) {
  if (sortField.value === field) {
    emit('update:sort', sortDesc.value ? field : `-${field}`)
    return
  }
  emit('update:sort', field === 'creativeName' ? field : `-${field}`)
}

function formatField(value: number | null, format: 'int' | 'dec' | 'pct'): string {
  if (format === 'int') return formatInt(value)
  if (format === 'pct') return formatPercent(value)
  return formatDecimal(value)
}

function adGroupLine(row: AdReportRow): string {
  return row.adGroupName ? `กลุ่ม: ${row.adGroupName}` : REPORT_DASH
}

const rangeFrom = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.limit + 1))
const rangeTo = computed(() => Math.min(props.page * props.limit, props.total))
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="min-w-0 overflow-x-auto" data-testid="rs-ads">
      <table class="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr class="bg-elevated/50">
            <th
              scope="col"
              class="cursor-pointer rounded-l-lg border-y border-l border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted select-none"
              :aria-sort="ariaSort('creativeName')"
              data-testid="rs-sort-creativeName"
              tabindex="0"
              @click="toggleSort('creativeName')"
              @keydown.enter.prevent="toggleSort('creativeName')"
              @keydown.space.prevent="toggleSort('creativeName')"
            >
              โฆษณา
            </th>
            <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
              Order / แคมเปญ
            </th>
            <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
              บัญชี
            </th>
            <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
              Advertiser
            </th>
            <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
              สถานะ
            </th>
            <th
              v-for="(column, index) in METRIC_COLUMNS"
              :key="column.field"
              scope="col"
              class="cursor-pointer border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted select-none"
              :class="index === METRIC_COLUMNS.length - 1 ? 'rounded-r-lg border-r' : ''"
              :aria-sort="ariaSort(column.field)"
              :data-testid="`rs-sort-${column.field}`"
              tabindex="0"
              @click="toggleSort(column.field)"
              @keydown.enter.prevent="toggleSort(column.field)"
              @keydown.space.prevent="toggleSort(column.field)"
            >
              {{ column.label }}
              <span v-if="sortField === column.field" aria-hidden="true">{{ sortDesc ? '▼' : '▲' }}</span>
            </th>
          </tr>
        </thead>
        <tbody :class="pending ? 'opacity-60' : ''">
          <tr v-if="pending && rows.length === 0" data-testid="rs-ads-loading">
            <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="12">
              กำลังโหลด…
            </td>
          </tr>
          <tr
            v-for="row in rows"
            :key="row.id"
            data-testid="rs-ad-row"
            :data-id="row.id"
            :data-state="row.state"
          >
            <!-- โฆษณา -->
            <td class="border-b border-default px-2 py-2">
              <div class="flex min-w-0 items-center gap-2">
                <ReportsAdThumb :url="row.media?.coverUrl ?? null" :is-video="!!row.media?.isVideo" />
                <span class="flex min-w-0 flex-col">
                  <span class="max-w-40 truncate font-medium text-highlighted" :title="row.creativeName ?? ''">
                    {{ row.creativeName || REPORT_DASH }}
                  </span>
                  <span class="max-w-40 truncate text-xs text-muted" :title="row.adGroupName ?? ''">
                    {{ adGroupLine(row) }}
                  </span>
                </span>
              </div>
            </td>

            <!-- Order / แคมเปญ -->
            <td class="border-b border-default px-2 py-2">
              <div class="flex min-w-0 flex-col">
                <NuxtLink
                  v-if="row.order"
                  :to="`/orders/${row.order.id}`"
                  class="max-w-32 truncate text-primary hover:underline"
                  :title="row.order.name"
                  data-testid="rs-ad-order"
                >
                  {{ row.order.name }}
                </NuxtLink>
                <UBadge
                  v-else
                  color="neutral"
                  variant="outline"
                  size="sm"
                  class="w-fit whitespace-nowrap"
                  title="โฆษณานี้ไม่ได้ถูกสร้างผ่านระบบ"
                  data-testid="rs-ad-unlinked"
                >
                  นอกระบบ
                </UBadge>
                <span class="font-mono text-xs text-muted" :title="row.tiktokCampaignId ?? ''">
                  campaign {{ last4(row.tiktokCampaignId) }}
                </span>
              </div>
            </td>

            <!-- บัญชี -->
            <td class="border-b border-default px-2 py-2 text-xs text-muted" data-testid="rs-ad-account">
              {{ row.account?.label || REPORT_DASH }}
            </td>

            <!-- Advertiser (no balance here — FEAT-034 owns balance) -->
            <td class="border-b border-default px-2 py-2" data-testid="rs-ad-advertiser">
              <div class="flex min-w-0 flex-col">
                <span class="max-w-28 truncate text-highlighted" :title="row.advertiser?.name ?? ''">
                  {{ row.advertiser?.name || REPORT_DASH }}
                </span>
                <span class="text-xs text-muted" :title="row.advertiser?.tiktokAdvertiserId ?? ''">
                  aadvid {{ last4(row.advertiser?.tiktokAdvertiserId) }}
                </span>
              </div>
            </td>

            <!-- สถานะ -->
            <td class="border-b border-default px-2 py-2">
              <ReportsLevelPills :status="row.status" testid="rs-ad-levels" />
            </td>

            <!-- metrics -->
            <template v-if="row.metrics">
              <td
                v-for="column in METRIC_COLUMNS"
                :key="column.field"
                class="border-b border-default px-2 py-2 text-right tabular-nums"
                :data-field="column.field"
              >
                {{ formatField(row.metrics[column.field], column.format) }}
              </td>
            </template>
            <td
              v-else
              class="border-b border-default px-2 py-2 text-center text-xs text-muted"
              colspan="7"
              data-testid="rs-ad-nodata"
            >
              รอรอบดึงข้อมูลแรก
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr data-testid="rs-ads-foot" :data-ads="total" class="bg-elevated font-semibold">
            <td class="rounded-bl-lg border-t border-l border-default px-2 py-2" colspan="5">
              รวมทั้งหมด · {{ formatInt(total) }} โฆษณา
            </td>
            <td
              v-for="(column, index) in METRIC_COLUMNS"
              :key="column.field"
              class="border-t border-default px-2 py-2 text-right tabular-nums"
              :class="index === METRIC_COLUMNS.length - 1 ? 'rounded-br-lg border-r' : ''"
              :data-field="column.field"
            >
              {{ formatField(totals ? totals[column.field] : null, column.format) }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div class="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span data-testid="rs-ads-count">แสดง {{ rangeFrom }}–{{ rangeTo }} จาก {{ total }}</span>

      <UPagination
        v-if="total > limit"
        :page="page"
        :items-per-page="limit"
        :total="total"
        data-testid="rs-ads-pagination"
        @update:page="(v: number) => emit('update:page', v)"
      />
    </div>
  </div>
</template>
