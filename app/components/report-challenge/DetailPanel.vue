<script setup lang="ts">
/**
 * FEAT-094 — the detail panel under the grid of `/reports/challenge` (spec "UI behaviour" → Detail panel,
 * api-contract.md v1 §4): the selected person's launching advertisers on the left, their top 3 ads (with
 * Ads monitor links, FEAT-072 shape) on the right. Selection is URL-only (`?admin=`), owned by the page.
 */
import type { ChallengeDeliveryState, ChallengePerson } from '#shared/types/report-challenge'

const props = defineProps<{
  person: ChallengePerson | null
  /** `null` = unranked or no person selected */
  rank: number | null
}>()

const title = computed(() => {
  if (!props.person) return REPORT_DASH
  const name = props.person.admin.displayName ?? props.person.admin.id
  return props.rank !== null ? `${name} — อันดับ ${props.rank}` : `${name} — ไม่มีอันดับ`
})

const sub = computed(() => {
  const l = props.person?.launching
  if (!l) return REPORT_DASH
  if (l.total === 0) return 'ไม่ได้ยิงอยู่ตอนนี้'
  const parts = [`กำลังยิง ${l.total} advertiser`, `ส่งอยู่ ${l.delivering}`, `ไม่ส่ง ${l.notDelivering}`]
  if (l.unknown > 0) parts.push(`ไม่ทราบ ${l.unknown}`)
  return parts.join(' · ')
})

const STATE_PILL: Record<ChallengeDeliveryState, { label: string, color: ReportColor }> = {
  delivering: { label: 'ส่งอยู่', color: 'success' },
  notDelivering: { label: 'ไม่ส่ง', color: 'warning' },
  unknown: { label: 'ไม่ทราบ', color: 'neutral' }
}

const moreCount = computed(() => {
  const l = props.person?.launching
  return l ? Math.max(0, l.total - l.list.length) : 0
})

function monitorLink(ad: { tiktokAccountId: string, advertiserId: string, campaignId: string }): string {
  return `/ads-monitor?tab=ad&tiktokAccountId=${ad.tiktokAccountId}&advertiserId=${ad.advertiserId}&campaignId=${ad.campaignId}&range=all`
}
</script>

<template>
  <section data-testid="rc-detail" :data-admin="person?.admin.id ?? ''" class="flex flex-col gap-4 rounded-lg border border-default p-4">
    <div>
      <h2 data-testid="rc-detail-title" class="font-semibold text-highlighted">
        {{ title }}
      </h2>
      <p data-testid="rc-detail-sub" class="text-sm text-muted">
        {{ sub }}
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div class="flex min-w-0 flex-col gap-2">
        <h3 class="text-sm font-medium text-highlighted">
          กำลังยิงอยู่ตอนนี้
        </h3>
        <div data-testid="rc-detail-live" class="flex flex-col divide-y divide-default">
          <template v-if="person && person.launching.list.length > 0">
            <div
              v-for="row in person.launching.list"
              :key="row.advertiserId"
              data-testid="rc-live-row"
              :data-id="row.advertiserId"
              :data-state="row.state"
              class="flex min-w-0 items-center justify-between gap-3 py-2 text-sm"
            >
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium text-highlighted">{{ row.name ?? row.advertiserId }}</span>
                <span v-if="row.account?.label" class="truncate text-xs text-muted">{{ row.account.label }}</span>
                <span v-if="row.state === 'notDelivering' && row.reasons.length > 0" class="truncate text-xs text-warning" :title="row.reasons.join(' · ')">
                  {{ monitorReasonTexts(row.reasons).join(', ') }}
                </span>
              </div>
              <UBadge
                :color="STATE_PILL[row.state].color"
                variant="subtle"
                size="xs"
                class="shrink-0"
              >
                {{ STATE_PILL[row.state].label }}
              </UBadge>
              <div class="flex shrink-0 flex-col items-end">
                <span class="text-sm font-medium tabular-nums">{{ formatThb(row.spend, 0) }}</span>
                <span class="text-[11px] text-dimmed">ยิงไป</span>
              </div>
            </div>
            <p v-if="moreCount > 0" data-testid="rc-live-more" class="pt-1 text-xs text-muted">
              +{{ moreCount }} รายการ
            </p>
          </template>
          <p v-else data-testid="rc-live-empty" class="text-sm text-muted">
            —
          </p>
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-2">
        <h3 class="text-sm font-medium text-highlighted">
          Top 3 โฆษณาที่มาดี
        </h3>
        <div data-testid="rc-detail-ads" class="flex flex-col gap-3">
          <template v-if="person && person.topAds.length > 0">
            <div
              v-for="(ad, i) in person.topAds"
              :key="ad.adId"
              data-testid="rc-top-ad"
              :data-id="ad.adId"
              :data-rank="i + 1"
              class="flex min-w-0 items-center gap-3"
            >
              <div class="relative shrink-0">
                <ReportsAdThumb :url="ad.coverUrl" :is-video="ad.isVideo" size="md" />
                <span class="absolute -left-1 -top-1 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-white">#{{ i + 1 }}</span>
              </div>
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium text-highlighted">{{ ad.creativeName || REPORT_DASH }}</span>
                <span class="truncate text-xs text-muted">{{ ad.campaignName || REPORT_DASH }}</span>
                <NuxtLink :to="monitorLink(ad)" class="text-xs text-primary hover:underline" data-testid="rc-top-ad-link">
                  เปิดใน Ads monitor →
                </NuxtLink>
              </div>
              <div class="flex shrink-0 flex-col items-end">
                <span class="text-lg font-semibold tabular-nums text-highlighted">{{ formatInt(ad.conversions) }}</span>
                <span class="text-[11px] text-dimmed">conversions</span>
              </div>
            </div>
          </template>
          <p v-else data-testid="rc-ads-empty" class="text-sm text-muted">
            ยังไม่มีโฆษณาที่มีผลในช่วงนี้
          </p>
        </div>
      </div>
    </div>
  </section>
</template>
