<script setup lang="ts">
/**
 * FEAT-069 — "delivery now" of `/reports/dashboard` (`rd-delivery`, from `GET /reports/dashboard/now`, spec
 * "UI behaviour → /reports/dashboard" 4): launching advertisers split by delivery (+ the top TikTok reasons,
 * translated through `monitorReasonTexts`, raw string on hover), ads by state, pending/failed switches and
 * deletes, banned advertisers; then the rejected-ads list (`rd-rejected`) and the not-delivering list
 * (`rd-not-delivering`), each absent when empty.
 */
import type { DashboardNowResponse } from '#shared/types/report-dashboard'

const props = defineProps<{
  now: DashboardNowResponse
}>()

const ADS_STATES = [
  { key: 'delivering', label: 'กำลังส่ง', tone: 'text-success' },
  { key: 'pending', label: 'รอตรวจ', tone: 'text-warning' },
  { key: 'rejected', label: 'ไม่ผ่าน', tone: 'text-error' },
  { key: 'ended', label: 'จบแล้ว', tone: 'text-muted' }
] as const

function reasonText(raw: string): string {
  return monitorReasonTexts([raw])[0] ?? raw
}

const ndCount = computed(() => props.now.launching.notDelivering)
</script>

<template>
  <section class="flex min-w-0 flex-col gap-3" data-testid="rd-delivery">
    <div class="flex flex-wrap items-baseline gap-2">
      <h2 class="flex items-center gap-1 text-sm font-semibold text-highlighted">
        <span>การส่งโฆษณาตอนนี้</span>
        <ReportsInfoHint id="rd-delivery" :text="REPORT_HELP['rd-delivery']!" />
      </h2>
      <span class="text-xs text-muted">สถานะล่าสุด ไม่เปลี่ยนตามช่วงวัน · ข้อมูลรอบ kpi {{ formatClock(now.refreshedAt) }}</span>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <!-- launching advertisers -->
      <NuxtLink
        to="/ads-monitor"
        class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-3 hover:bg-elevated/50"
        data-testid="rd-delivery-launching"
        :data-value="now.launching.total"
      >
        <span class="flex items-center gap-1 text-xs text-muted">
          <span>กำลังยิง</span>
          <ReportsInfoHint id="rd-delivery-launching" :text="REPORT_HELP['rd-delivery-launching']!" />
        </span>
        <span class="text-xl font-semibold tabular-nums text-highlighted">{{ formatInt(now.launching.total) }} advertiser</span>
        <span class="flex flex-wrap items-center gap-x-3 text-xs">
          <span class="flex items-center gap-0.5 text-success" data-testid="rd-delivery-delivering" :data-value="now.launching.delivering">
            <span>ส่ง {{ formatInt(now.launching.delivering) }}</span>
            <ReportsInfoHint id="rd-delivery-delivering" :text="REPORT_HELP['rd-delivery-delivering']!" />
          </span>
          <span
            class="flex items-center gap-0.5"
            :class="ndCount > 0 ? 'font-semibold text-warning' : 'text-muted'"
            data-testid="rd-delivery-notDelivering"
            :data-value="ndCount"
          >
            <span>ไม่ส่ง {{ formatInt(ndCount) }}</span>
            <ReportsInfoHint id="rd-delivery-notDelivering" :text="REPORT_HELP['rd-delivery-notDelivering']!" />
          </span>
          <span class="flex items-center gap-0.5 text-muted" data-testid="rd-delivery-unknown" :data-value="now.launching.unknown">
            <span>ไม่ทราบ {{ formatInt(now.launching.unknown) }}</span>
            <ReportsInfoHint id="rd-delivery-unknown" :text="REPORT_HELP['rd-delivery-unknown']!" />
          </span>
        </span>
        <div v-if="now.reasons.length > 0" class="mt-1 flex items-center gap-1 text-xs text-muted">
          <span>เหตุผลที่ไม่ส่ง</span>
          <ReportsInfoHint id="rd-delivery-reasons" :text="REPORT_HELP['rd-delivery-reasons']!" />
        </div>
        <ul v-if="now.reasons.length > 0" class="flex flex-col gap-0.5 text-xs" data-testid="rd-delivery-reasons">
          <li
            v-for="r in now.reasons"
            :key="r.reason"
            class="flex justify-between gap-2"
            data-testid="rd-reason-row"
            :data-reason="r.reason"
            :title="r.reason"
          >
            <span class="truncate text-muted">{{ reasonText(r.reason) }}</span>
            <span class="tabular-nums">{{ formatInt(r.count) }}</span>
          </li>
        </ul>
      </NuxtLink>

      <!-- ads by state -->
      <div class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-3" data-testid="rd-ads-states" :data-value="now.ads.total">
        <span class="flex items-center gap-1 text-xs text-muted">
          <span>โฆษณา {{ formatInt(now.ads.total) }} ตัว</span>
          <ReportsInfoHint id="rd-ads-states" :text="REPORT_HELP['rd-ads-states']!" />
        </span>
        <dl class="grid grid-cols-2 gap-x-3 gap-y-1">
          <div
            v-for="s in ADS_STATES"
            :key="s.key"
            class="flex min-w-0 flex-col"
            :data-testid="`rd-ads-${s.key}`"
            :data-value="now.ads[s.key]"
          >
            <dt class="text-xs text-muted">
              {{ s.label }}
            </dt>
            <dd class="text-lg font-semibold tabular-nums" :class="s.key === 'rejected' && now.ads.rejected > 0 ? 'text-error' : s.tone">
              {{ formatInt(now.ads[s.key]) }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- pending switches / deletes -->
      <div class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-3" data-testid="rd-pending">
        <span class="flex items-center gap-1 text-xs text-muted">
          <span>สวิตช์ / การลบ</span>
          <ReportsInfoHint id="rd-pending" :text="REPORT_HELP['rd-pending']!" />
        </span>
        <dl class="grid grid-cols-2 gap-x-3 gap-y-1">
          <div class="flex flex-col" data-testid="rd-pending-optPending" :data-value="now.pending.optPending">
            <dt class="text-xs text-muted">
              สวิตช์รอทำ
            </dt>
            <dd class="text-lg font-semibold tabular-nums">
              {{ formatInt(now.pending.optPending) }}
            </dd>
          </div>
          <div class="flex flex-col" data-testid="rd-pending-optError" :data-value="now.pending.optError">
            <dt class="text-xs text-muted">
              สวิตช์ล้ม
            </dt>
            <dd class="text-lg font-semibold tabular-nums" :class="now.pending.optError > 0 ? 'text-error' : ''">
              {{ formatInt(now.pending.optError) }}
            </dd>
          </div>
          <div class="flex flex-col" data-testid="rd-pending-deletePending" :data-value="now.pending.deletePending">
            <dt class="text-xs text-muted">
              ลบรอทำ
            </dt>
            <dd class="text-lg font-semibold tabular-nums">
              {{ formatInt(now.pending.deletePending) }}
            </dd>
          </div>
          <div class="flex flex-col" data-testid="rd-pending-deleteError" :data-value="now.pending.deleteError">
            <dt class="text-xs text-muted">
              ลบล้ม
            </dt>
            <dd class="text-lg font-semibold tabular-nums" :class="now.pending.deleteError > 0 ? 'text-error' : ''">
              {{ formatInt(now.pending.deleteError) }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- banned -->
      <NuxtLink
        to="/reports/banned"
        class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-3 hover:bg-elevated/50"
        data-testid="rd-banned"
      >
        <span class="flex items-center gap-1 text-xs text-muted">
          <span>ถูกระงับ</span>
          <ReportsInfoHint id="rd-banned" :text="REPORT_HELP['rd-banned']!" />
        </span>
        <span
          class="text-xl font-semibold tabular-nums"
          :class="now.banned.now > 0 ? 'text-error' : 'text-highlighted'"
          data-testid="rd-banned-now"
          :data-value="now.banned.now"
        >{{ formatInt(now.banned.now) }} ตอนนี้</span>
        <span class="text-xs text-muted">ดูรายการ →</span>
      </NuxtLink>
    </div>

    <div v-if="now.rejected.length > 0" class="rounded-lg border border-error/30 p-3" data-testid="rd-rejected">
      <h3 class="mb-2 flex items-center gap-1 text-xs font-semibold text-error">
        <span>โฆษณาไม่ผ่าน ({{ formatInt(now.ads.rejected) }})</span>
        <ReportsInfoHint id="rd-rejected" :text="REPORT_HELP['rd-rejected']!" />
      </h3>
      <ul class="flex flex-col divide-y divide-default">
        <li
          v-for="ad in now.rejected"
          :key="ad.adId"
          class="flex min-w-0 items-center gap-3 py-1.5 text-sm"
          data-testid="rd-rejected-row"
          :data-id="ad.adId"
        >
          <ReportsAdThumb :url="ad.coverUrl" :is-video="ad.isVideo" />
          <div class="flex min-w-0 flex-1 flex-col">
            <span class="truncate font-medium text-highlighted">{{ ad.creativeName ?? REPORT_DASH }}</span>
            <span class="truncate text-xs text-muted">{{ [ad.campaignName, ad.adGroupName].filter(Boolean).join(' › ') || REPORT_DASH }} · {{ ad.advertiser?.name ?? REPORT_DASH }} · {{ perfAccountName(ad.account) }}</span>
            <span class="truncate text-xs text-error" :title="ad.reasons.join(' · ')">{{ monitorReasonTexts(ad.reasons).join(', ') || REPORT_DASH }}</span>
          </div>
        </li>
      </ul>
    </div>

    <div v-if="now.notDelivering.length > 0" class="rounded-lg border border-warning/40 p-3" data-testid="rd-not-delivering">
      <h3 class="mb-2 flex items-center gap-1 text-xs font-semibold text-warning">
        <span>กำลังยิงแต่ไม่ส่ง ({{ formatInt(now.notDelivering.length) }})</span>
        <ReportsInfoHint id="rd-not-delivering" :text="REPORT_HELP['rd-not-delivering']!" />
      </h3>
      <ul class="flex flex-col divide-y divide-default">
        <li
          v-for="item in now.notDelivering"
          :key="item.advertiserId"
          class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm"
          data-testid="rd-nd-row"
          :data-id="item.advertiserId"
        >
          <span class="min-w-0 truncate font-medium text-highlighted">{{ item.name ?? item.advertiserId }}</span>
          <span class="min-w-0 truncate text-xs text-muted">{{ perfAccountName(item.account) }}{{ item.workspace?.name ? ` · ${item.workspace.name}` : '' }}</span>
          <span class="min-w-0 truncate text-xs text-warning" :title="item.reasons.join(' · ')">{{ monitorReasonTexts(item.reasons).join(', ') || REPORT_DASH }}</span>
          <span class="text-xs text-muted">ตั้งแต่ {{ formatDateTime(item.since) }}</span>
          <NuxtLink to="/ads-monitor" class="ml-auto text-xs text-primary hover:underline">
            ไปแก้ →
          </NuxtLink>
        </li>
      </ul>
    </div>
  </section>
</template>
