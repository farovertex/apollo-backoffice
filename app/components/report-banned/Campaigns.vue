<script setup lang="ts">
/**
 * FEAT-056 — the per-advertiser campaign table that opens under a `/reports/banned` row
 * (api-contract.md v1 §6.2; spec "UI behaviour" → `/reports/banned`, AC-25).
 *
 * Pure presentation: the page owns the request and hands the whole state in (`pending` / `error` / `data`),
 * so a range change can reset every expansion at once. The footer `rb-campaigns-total` prints the response's
 * `totals`, which the API guarantees equals the parent row's numbers — never a sum of what is on screen.
 *
 * Desktop/tablet render a nested table, mobile renders stacked `rb-campaign-card`s. The two are switched by
 * `useMediaQuery`, not by `hidden sm:block`, so `rb-campaigns-total` exists exactly **once** in the DOM
 * (a duplicated test id would break Playwright's strict mode). The component only ever mounts after a click,
 * so the media query is always evaluated on the client — no hydration mismatch.
 *
 * Because the expansion lives inside the parent table's `overflow-x-auto` wrapper, the content is pinned with
 * `sticky left-0` and a viewport-bound width on mobile: scrolling the wide parent table sideways keeps it visible.
 */
import type { BannedCampaignRow, BannedCampaignsState } from '#shared/types/report-banned'
import type { KpiMetrics } from '#shared/types/reports'

const props = defineProps<{
  advertiserId: string
  state?: BannedCampaignsState
}>()

const emit = defineEmits<{ retry: [] }>()

const COLUMNS: { field: keyof KpiMetrics | 'adCount', label: string, format: 'int' | 'dec' }[] = [
  { field: 'adCount', label: 'โฆษณา', format: 'int' },
  { field: 'spend', label: 'Spend', format: 'dec' },
  { field: 'impressions', label: 'Impr.', format: 'int' },
  { field: 'clicks', label: 'Clicks', format: 'int' },
  { field: 'conversions', label: 'Conv.', format: 'int' },
  { field: 'conversionCost', label: 'CPA', format: 'dec' }
]

/** `sm` breakpoint of Tailwind v4 — table above, cards below (see the header comment on why not CSS-only). */
const isWide = useMediaQuery('(min-width: 640px)')

const loading = computed(() => !props.state || props.state.pending)
const error = computed(() => props.state?.error ?? null)
const data = computed(() => props.state?.data ?? null)
const rows = computed(() => data.value?.rows ?? [])

function cellValue(row: BannedCampaignRow, field: string): number | null {
  return field === 'adCount' ? row.adCount : row.metrics[field as keyof KpiMetrics]
}

function footValue(field: string): number | null {
  if (!data.value) return null
  return field === 'adCount' ? data.value.adCount : data.value.totals[field as keyof KpiMetrics]
}

function formatField(value: number | null, format: 'int' | 'dec'): string {
  return format === 'int' ? formatInt(value) : formatDecimal(value)
}
</script>

<template>
  <div class="sticky left-0 w-[calc(100vw-4rem)] max-w-full sm:static sm:w-auto">
    <div
      v-if="loading"
      class="flex flex-col gap-2 py-1"
      data-testid="rb-campaigns-loading"
      :data-id="advertiserId"
    >
      <USkeleton class="h-6 w-full" />
      <USkeleton class="h-6 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดแคมเปญไม่สำเร็จ"
      :description="error"
      data-testid="rb-campaigns-error"
      :data-id="advertiserId"
    >
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          size="xs"
          data-testid="rb-campaigns-retry"
          :data-id="advertiserId"
          @click="emit('retry')"
        />
      </template>
    </UAlert>

    <p
      v-else-if="rows.length === 0"
      class="py-2 text-sm text-muted"
      data-testid="rb-campaigns-empty"
      :data-id="advertiserId"
    >
      ไม่มีแคมเปญในช่วงที่เลือก
    </p>

    <div v-else data-testid="rb-campaigns" :data-id="advertiserId">
      <!-- desktop / tablet: nested table -->
      <table v-if="isWide" class="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th scope="col" class="border-b border-default px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted">
              แคมเปญ
            </th>
            <th scope="col" class="border-b border-default px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted">
              Order
            </th>
            <th scope="col" class="border-b border-default px-2 py-1.5 text-left font-medium whitespace-nowrap text-muted">
              สร้างเมื่อ
            </th>
            <th
              v-for="column in COLUMNS"
              :key="column.field"
              scope="col"
              class="border-b border-default px-2 py-1.5 text-right font-medium whitespace-nowrap text-muted"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.id"
            data-testid="rb-campaign-row"
            :data-id="row.id"
          >
            <td class="border-b border-default px-2 py-1.5">
              <span class="flex min-w-0 flex-col">
                <span class="max-w-56 truncate" :title="row.name">{{ row.name || REPORT_DASH }}</span>
                <span class="text-xs text-muted">{{ row.id || REPORT_DASH }}</span>
              </span>
            </td>
            <td class="border-b border-default px-2 py-1.5 whitespace-nowrap">
              <template v-if="row.orderIds.length > 0">
                <ULink :to="`/orders/${row.orderIds[0]}`" class="text-primary">{{ last4(row.orderIds[0]) }}</ULink>
                <span v-if="row.orderIds.length > 1" class="ml-1 text-xs text-muted">+{{ row.orderIds.length - 1 }}</span>
              </template>
              <template v-else>
                {{ REPORT_DASH }}
              </template>
            </td>
            <td
              class="border-b border-default px-2 py-1.5 whitespace-nowrap tabular-nums"
              :data-iso="row.createdAt ?? ''"
            >
              {{ formatDateTime(row.createdAt) }}
            </td>
            <td
              v-for="column in COLUMNS"
              :key="column.field"
              class="border-b border-default px-2 py-1.5 text-right tabular-nums"
              :data-field="column.field"
            >
              {{ formatField(cellValue(row, column.field), column.format) }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr class="font-semibold" data-testid="rb-campaigns-total" :data-id="advertiserId">
            <td colspan="3" class="px-2 py-1.5">
              รวม {{ formatInt(data?.campaignCount ?? null) }} แคมเปญ
            </td>
            <td
              v-for="column in COLUMNS"
              :key="column.field"
              class="px-2 py-1.5 text-right tabular-nums"
              :data-field="column.field"
            >
              {{ formatField(footValue(column.field), column.format) }}
            </td>
          </tr>
        </tfoot>
      </table>

      <!-- mobile: one card per campaign + a total card carrying the same `rb-campaigns-total` testid -->
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="row in rows"
          :key="row.id"
          class="rounded-lg border border-default p-2 text-sm"
          data-testid="rb-campaign-card"
          :data-id="row.id"
        >
          <p class="truncate font-medium" :title="row.name">
            {{ row.name || REPORT_DASH }}
          </p>
          <p class="text-xs text-muted">
            {{ row.id || REPORT_DASH }} · {{ formatDateTime(row.createdAt) }}
          </p>
          <p v-if="row.orderIds.length > 0" class="mt-1 text-xs">
            Order
            <ULink :to="`/orders/${row.orderIds[0]}`" class="text-primary">{{ last4(row.orderIds[0]) }}</ULink>
            <span v-if="row.orderIds.length > 1" class="ml-1 text-muted">+{{ row.orderIds.length - 1 }}</span>
          </p>
          <dl class="mt-1 grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
            <div v-for="column in COLUMNS" :key="column.field" :data-field="column.field">
              <dt class="text-muted">
                {{ column.label }}
              </dt>
              <dd class="tabular-nums">
                {{ formatField(cellValue(row, column.field), column.format) }}
              </dd>
            </div>
          </dl>
        </div>

        <div
          class="rounded-lg border border-default bg-elevated p-2 text-sm font-semibold"
          data-testid="rb-campaigns-total"
          :data-id="advertiserId"
        >
          <p>รวม {{ formatInt(data?.campaignCount ?? null) }} แคมเปญ</p>
          <dl class="mt-1 grid grid-cols-3 gap-x-2 gap-y-1 text-xs">
            <div v-for="column in COLUMNS" :key="column.field" :data-field="column.field">
              <dt class="font-normal text-muted">
                {{ column.label }}
              </dt>
              <dd class="tabular-nums">
                {{ formatField(footValue(column.field), column.format) }}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  </div>
</template>
