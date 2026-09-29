<script setup lang="ts">
/**
 * FEAT-020 — the ads table of `/reports` (api-contract §6.2 `rp-table` / `rp-row`) and of the order Report
 * tab (§6.4 `or-table` / `or-row`, "same cells minus order/advertiser"). One component, two prefixes: the
 * cells inside a row keep their `rp-row-*` testids in both places because the contract names them once.
 *
 * The markup is a plain `<table>` (like `/orders`) so every `<tr>` can carry `data-id` / `data-state` and be
 * opened with a click or Enter; the scroll happens in the wrapper, never on the page (AC-28).
 * A row whose `metrics` is `null` replaces the seven metric cells with one `rp-row-nodata` cell.
 */
import type { AdReportRow, ReportSortField } from '#shared/types/reports'

const props = withDefaults(defineProps<{
  rows: AdReportRow[]
  intervalMs: number
  nowMs: number
  /** `rp` on `/reports`, `or` inside the order Report tab */
  prefix?: 'rp' | 'or'
  /** hide the Order and Advertiser columns (the order tab knows both already) */
  compact?: boolean
  /** current sort of the list, e.g. `-spend`; only the `rp` table sorts */
  sort?: string
  sortable?: boolean
  pending?: boolean
  /** id of the row whose slideover is open (highlighted) */
  activeId?: string | null
}>(), {
  prefix: 'rp',
  compact: false,
  sort: '-spend',
  sortable: false,
  pending: false,
  activeId: null
})

const emit = defineEmits<{
  'select': [row: AdReportRow]
  'update:sort': [value: string]
}>()

const sortField = computed<string>(() => props.sort.replace(/^-/, ''))
const sortDesc = computed(() => props.sort.startsWith('-'))

function ariaSort(field: ReportSortField): 'ascending' | 'descending' | 'none' {
  if (!props.sortable || sortField.value !== field) return 'none'
  return sortDesc.value ? 'descending' : 'ascending'
}

/** first click on a new column = descending for metrics, ascending for the name; then it toggles */
function toggleSort(field: ReportSortField) {
  if (!props.sortable) return
  if (sortField.value === field) {
    emit('update:sort', sortDesc.value ? field : `-${field}`)
    return
  }
  emit('update:sort', field === 'creativeName' ? field : `-${field}`)
}

const columnCount = computed(() => (props.compact ? 11 : 13))

/** "กลุ่ม: <ad group>" — the second line of the ad cell */
function adGroupLine(row: AdReportRow): string {
  return row.adGroupName ? `กลุ่ม: ${row.adGroupName}` : REPORT_DASH
}
</script>

<template>
  <div class="min-w-0 overflow-x-auto" :data-testid="`${prefix}-table`">
    <table class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr class="bg-elevated/50">
          <th
            scope="col"
            class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
            :aria-sort="ariaSort('creativeName')"
            :data-testid="sortable ? 'rp-sort-creativeName' : undefined"
            :class="sortable ? 'cursor-pointer select-none' : ''"
            :tabindex="sortable ? 0 : undefined"
            @click="toggleSort('creativeName')"
            @keydown.enter.prevent="toggleSort('creativeName')"
            @keydown.space.prevent="toggleSort('creativeName')"
          >
            โฆษณา
          </th>
          <template v-if="!compact">
            <th scope="col" class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
              Order / แคมเปญ
            </th>
            <th scope="col" class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
              Advertiser
            </th>
          </template>
          <th scope="col" class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
            สถานะ
          </th>
          <th
            v-for="column in ([
              { field: 'spend', label: 'Spend' },
              { field: 'impressions', label: 'Impr.' },
              { field: 'clicks', label: 'Clicks' },
              { field: 'ctr', label: 'CTR' },
              { field: 'cpc', label: 'CPC' },
              { field: 'conversions', label: 'Conv.' },
              { field: 'conversionCost', label: 'CPA' }
            ] as { field: ReportSortField, label: string }[])"
            :key="column.field"
            scope="col"
            class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted"
            :aria-sort="ariaSort(column.field)"
            :data-testid="sortable ? `rp-sort-${column.field}` : undefined"
            :class="sortable ? 'cursor-pointer select-none' : ''"
            :tabindex="sortable ? 0 : undefined"
            @click="toggleSort(column.field)"
            @keydown.enter.prevent="toggleSort(column.field)"
            @keydown.space.prevent="toggleSort(column.field)"
          >
            {{ column.label }}
            <span v-if="sortable && sortField === column.field" aria-hidden="true">{{ sortDesc ? '▼' : '▲' }}</span>
          </th>
          <th scope="col" class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
            แนวโน้มวันนี้
          </th>
          <th
            scope="col"
            class="rounded-r-lg border-y border-r border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
            :aria-sort="ariaSort('lastSeenAt')"
            :data-testid="sortable ? 'rp-sort-lastSeenAt' : undefined"
            :class="sortable ? 'cursor-pointer select-none' : ''"
            :tabindex="sortable ? 0 : undefined"
            @click="toggleSort('lastSeenAt')"
            @keydown.enter.prevent="toggleSort('lastSeenAt')"
            @keydown.space.prevent="toggleSort('lastSeenAt')"
          >
            อัปเดต
          </th>
        </tr>
      </thead>
      <tbody :class="pending ? 'opacity-60' : ''">
        <tr v-if="pending && rows.length === 0" data-testid="rp-table-loading">
          <td class="border-b border-default px-3 py-6 text-center text-muted" :colspan="columnCount">
            กำลังโหลด…
          </td>
        </tr>
        <tr
          v-for="row in rows"
          :key="row.id"
          :data-id="row.id"
          :data-state="row.state"
          :data-linked="row.linked ? 'true' : 'false'"
          data-slot="tr"
          :data-testid="`${prefix}-row`"
          class="cursor-pointer"
          :class="activeId === row.id ? 'bg-primary/5' : ''"
          tabindex="0"
          @click="emit('select', row)"
          @keydown.enter.prevent="emit('select', row)"
        >
          <!-- โฆษณา -->
          <td class="border-b border-default px-3 py-2">
            <div class="flex min-w-0 items-center gap-2">
              <ReportsAdThumb :url="row.media?.coverUrl ?? null" :is-video="!!row.media?.isVideo" />
              <span class="flex min-w-0 flex-col">
                <span class="max-w-52 truncate font-medium text-highlighted" :title="row.creativeName ?? ''">
                  {{ row.creativeName || REPORT_DASH }}
                </span>
                <span class="max-w-52 truncate text-xs text-muted" :title="row.adGroupName ?? ''">
                  {{ adGroupLine(row) }}
                </span>
              </span>
            </div>
          </td>

          <!-- Order / แคมเปญ -->
          <td v-if="!compact" class="border-b border-default px-3 py-2">
            <div class="flex min-w-0 flex-col">
              <NuxtLink
                v-if="row.order"
                :to="`/orders/${row.order.id}`"
                class="max-w-44 truncate text-primary hover:underline"
                :title="row.order.name"
                data-testid="rp-row-order"
                @click.stop
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
                data-testid="rp-row-unlinked"
              >
                นอกระบบ
              </UBadge>
              <span class="font-mono text-xs text-muted" :title="row.tiktokCampaignId ?? ''">
                campaign {{ last4(row.tiktokCampaignId) }}
              </span>
            </div>
          </td>

          <!-- Advertiser -->
          <td v-if="!compact" class="border-b border-default px-3 py-2">
            <div class="flex min-w-0 flex-col">
              <span class="max-w-40 truncate text-highlighted" :title="row.advertiser?.name ?? ''">
                {{ row.advertiser?.name || REPORT_DASH }}
              </span>
              <span class="text-xs text-muted" :title="row.advertiser?.tiktokAdvertiserId ?? ''">
                aadvid {{ last4(row.advertiser?.tiktokAdvertiserId) }}
              </span>
            </div>
          </td>

          <!-- สถานะ -->
          <td class="border-b border-default px-3 py-2">
            <ReportsLevelPills :status="row.status" />
          </td>

          <!-- metrics -->
          <template v-if="row.metrics">
            <td class="border-b border-default px-2 py-2 text-right tabular-nums">
              {{ formatDecimal(row.metrics.spend) }}
            </td>
            <td class="border-b border-default px-2 py-2 text-right tabular-nums">
              {{ formatInt(row.metrics.impressions) }}
            </td>
            <td class="border-b border-default px-2 py-2 text-right tabular-nums">
              {{ formatInt(row.metrics.clicks) }}
            </td>
            <td class="border-b border-default px-2 py-2 text-right tabular-nums">
              {{ formatPercent(row.metrics.ctr) }}
            </td>
            <td class="border-b border-default px-2 py-2 text-right tabular-nums">
              {{ formatDecimal(row.metrics.cpc) }}
            </td>
            <td class="border-b border-default px-2 py-2 text-right tabular-nums">
              {{ formatInt(row.metrics.conversions) }}
            </td>
            <td class="border-b border-default px-2 py-2 text-right tabular-nums">
              {{ formatDecimal(row.metrics.conversionCost) }}
            </td>
          </template>
          <td
            v-else
            class="border-b border-default px-2 py-2 text-center text-xs text-muted"
            colspan="7"
            data-testid="rp-row-nodata"
          >
            รอรอบดึงข้อมูลแรก
          </td>

          <!-- แนวโน้มวันนี้ -->
          <td class="border-b border-default px-3 py-2">
            <ReportsSparkline :values="row.sparkline" />
          </td>

          <!-- อัปเดต -->
          <td class="border-b border-default px-3 py-2">
            <ReportsUpdatedCell
              :last-fetch-at="row.lastFetchAt"
              :fetch-error="row.fetchError"
              :fetching="row.fetching"
              :interval-ms="intervalMs"
              :now-ms="nowMs"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
