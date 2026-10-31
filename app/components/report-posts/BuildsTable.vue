<script setup lang="ts">
/**
 * FEAT-089 — `rp-builds` of `/reports/posts/:key` (spec "UI behaviour → /reports/posts/:key"): one row per
 * build, newest `publishedAt` first (the API's own order, contract §3 "builds newest first"), ≤ 300 with
 * `buildsTruncated`.
 */
import type { PostReportBuild } from '#shared/types/report-posts'

const props = defineProps<{
  builds: PostReportBuild[]
  truncated: boolean
}>()

function chip(b: PostReportBuild) {
  return buildEndChip(b.outcome.review, b.outcome.end, b.outcome.endDay, b.reviewHours, b.reason)
}

const totalCount = computed(() => props.builds.length)
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="rp-builds">
    <h2 class="text-sm font-semibold text-highlighted">
      Build ทั้งหมด ({{ formatInt(totalCount) }})
    </h2>
    <div class="min-w-0 max-h-[32rem] overflow-auto rounded-lg border border-default">
      <table v-if="builds.length > 0" class="w-full border-separate border-spacing-0 text-sm whitespace-nowrap">
        <thead>
          <tr class="bg-elevated">
            <th class="sticky top-0 z-10 border-y border-l border-default bg-elevated px-2 py-2 text-left text-xs font-medium text-muted">
              บัญชี
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-left text-xs font-medium text-muted">
              advertiser
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-left text-xs font-medium text-muted">
              เผยแพร่
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-right text-xs font-medium text-muted">
              ผ่านตรวจใน
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-left text-xs font-medium text-muted">
              ปลายทาง
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-right text-xs font-medium text-muted">
              อยู่ (วัน)
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-right text-xs font-medium text-muted">
              Spend
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-right text-xs font-medium text-muted">
              Deposit
            </th>
            <th class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 text-right text-xs font-medium text-muted">
              Dep/Budget
            </th>
            <th class="sticky top-0 z-10 border-y border-r border-default bg-elevated px-2 py-2 text-left text-xs font-medium text-muted">
              Template
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="b in builds"
            :key="b.id"
            class="border-b border-default/60"
            data-testid="rp-build-row"
            :data-id="b.id"
          >
            <td class="max-w-32 truncate px-2 py-2">
              {{ b.account.label ?? b.account.id }}
            </td>
            <td class="max-w-32 truncate px-2 py-2">
              {{ b.advertiser.name ?? b.advertiser.id }}
              <span v-if="b.advertiser.currency" class="text-xs text-dimmed">({{ b.advertiser.currency }})</span>
            </td>
            <td class="px-2 py-2">
              {{ formatDateTime(b.publishedAt) }}
            </td>
            <td class="px-2 py-2 text-right tabular-nums">
              {{ formatHoursMinutes(b.reviewHours) }}
            </td>
            <td class="px-2 py-2">
              <UBadge
                :color="chip(b).color"
                variant="subtle"
                size="sm"
                data-testid="rp-build-end"
                :data-end="chip(b).key"
              >
                {{ chip(b).label }}
              </UBadge>
            </td>
            <td class="px-2 py-2 text-right tabular-nums">
              {{ formatPostDecimal1(b.aliveDays) }}
            </td>
            <td class="px-2 py-2 text-right tabular-nums">
              <MoneyCell :thb="b.spend" :native="{ amount: b.spend, currency: b.currency }" :unconverted="b.spendUnconverted ?? null" />
            </td>
            <td class="px-2 py-2 text-right tabular-nums">
              {{ formatDecimal(b.deposit) }}
            </td>
            <td class="px-2 py-2 text-right tabular-nums">
              {{ formatDecimal(b.depPerBudget) }}
            </td>
            <td class="max-w-44 truncate px-2 py-2">
              <NuxtLink :to="`/orders/${b.orderId}`" class="text-primary hover:underline" data-testid="rp-build-order-link">
                {{ b.adTemplateName ?? REPORT_DASH }} · {{ b.adGroupTemplateName ?? REPORT_DASH }}
              </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="px-3 py-4 text-center text-sm text-muted" data-testid="rp-builds-empty">
        ไม่มี build ในช่วงนี้
      </p>
    </div>
    <p v-if="truncated" class="text-xs text-warning" data-testid="rp-builds-truncated">
      แสดงเฉพาะ 300 build ล่าสุด … ยังมี build อื่นอีกในช่วงนี้ที่ไม่ได้แสดง
    </p>
  </section>
</template>
