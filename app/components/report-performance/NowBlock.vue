<script setup lang="ts">
/**
 * FEAT-069 — section 3 of `/reports/performance` (`rf-now`): accounts held, advertisers banned, advertisers
 * launching. FEAT-103 v2: the BIG figure of each card is the in-range value (`rf-range-*`, from the response's
 * `inRange`, follows the range picker); the range-independent "now" value (`rf-now-*` `data-value`) is the
 * small `ตอนนี้` line. Then the "ต้องดู" box (always now, marked `ตอนนี้`) (`rf-watch`), rendered only when one of the
 * four lists has a row. Each row (`rf-watch-row`, `data-kind`) links to the page that fixes it.
 */
import type { PerfInRange, PerfNow } from '#shared/types/report-performance'

const props = defineProps<{
  now: PerfNow
  /** FEAT-103 — what happened in the selected range (api-contract v1 §1) */
  inRange: PerfInRange
}>()

type WatchKind = 'banned' | 'needsHuman' | 'loggedOut' | 'notDelivering'

interface WatchRow {
  key: string
  kind: WatchKind
  label: string
  name: string
  sub: string
  detail: string
  to: string
}

const KIND_LABEL: Record<WatchKind, string> = {
  banned: 'ถูกระงับ',
  needsHuman: 'ต้องมีคน',
  loggedOut: 'หลุด login',
  notDelivering: 'ไม่ส่ง'
}

const KIND_COLOR: Record<WatchKind, ReportColor> = {
  banned: 'error',
  needsHuman: 'warning',
  loggedOut: 'warning',
  notDelivering: 'warning'
}

const rows = computed<WatchRow[]>(() => {
  const out: WatchRow[] = []
  for (const item of props.now.banned.list) {
    out.push({
      key: `b-${item.advertiserId}`,
      kind: 'banned',
      label: KIND_LABEL.banned,
      name: item.name ?? item.advertiserId,
      sub: [perfAccountName(item.account), item.workspace?.name].filter(Boolean).join(' · '),
      detail: `เห็นเมื่อ ${formatDateTime(item.bannedAt)}`,
      to: '/reports/banned'
    })
  }
  for (const kind of ['needsHuman', 'loggedOut'] as const) {
    for (const item of props.now[kind].list) {
      out.push({
        key: `${kind}-${item.accountId}`,
        kind,
        label: KIND_LABEL[kind],
        name: perfAccountName({ id: item.accountId, label: item.label, loginEmail: item.loginEmail }),
        sub: item.workspace?.name ?? '',
        detail: item.lastLoginError ?? REPORT_DASH,
        to: '/tiktok-accounts'
      })
    }
  }
  for (const item of props.now.notDelivering.list) {
    out.push({
      key: `nd-${item.advertiserId}`,
      kind: 'notDelivering',
      label: KIND_LABEL.notDelivering,
      name: item.name ?? item.advertiserId,
      sub: [perfAccountName(item.account), item.workspace?.name].filter(Boolean).join(' · '),
      detail: [monitorReasonTexts(item.reasons).join(', ') || REPORT_DASH, item.since ? `ตั้งแต่ ${formatDateTime(item.since)}` : '']
        .filter(Boolean).join(' · '),
      to: '/ads-monitor'
    })
  }
  return out
})
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="rf-now">
    <div class="flex flex-wrap items-baseline gap-2">
      <h2 class="text-sm font-semibold text-highlighted">
        ตอนนี้
      </h2>
      <span class="text-xs text-muted">ตัวเลขใหญ่ = ในช่วงวันที่เลือก · "ตอนนี้" = สถานะล่าสุด ไม่ขึ้นกับช่วงวัน</span>
    </div>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <NuxtLink
        to="/tiktok-accounts"
        class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3 hover:bg-elevated/50"
        data-testid="rf-now-accounts"
        :data-value="now.accounts"
      >
        <span class="flex items-center gap-1 text-xs text-muted">
          <span>บัญชีที่ถืออยู่</span>
          <ReportsInfoHint id="rf-now-accounts" :text="REPORT_HELP['rf-now-accounts']!" />
        </span>
        <span
          class="flex min-w-0 flex-col gap-0.5"
          data-testid="rf-range-accounts"
          :data-value="inRange.accounts"
          :data-advertisers="inRange.advertisers"
        >
          <span class="flex flex-wrap items-center gap-x-1">
            <span class="text-xl font-semibold tabular-nums text-highlighted">{{ formatInt(inRange.accounts) }} บัญชี</span>
            <ReportsInfoHint id="rf-range-accounts" :text="REPORT_HELP['rf-range-accounts']!" />
          </span>
          <span class="text-xs text-muted">{{ formatInt(inRange.advertisers) }} advertiser</span>
        </span>
        <span class="mt-1 border-t border-default pt-1 text-xs text-muted">ตอนนี้ {{ formatInt(now.accounts) }} บัญชี · {{ formatInt(now.advertisers) }} advertiser</span>
      </NuxtLink>
      <NuxtLink
        to="/reports/banned"
        class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3 hover:bg-elevated/50"
        data-testid="rf-now-banned"
        :data-value="now.banned.count"
      >
        <span class="flex items-center gap-1 text-xs text-muted">
          <span>Advertiser ถูกระงับ</span>
          <ReportsInfoHint id="rf-now-banned" :text="REPORT_HELP['rf-now-banned']!" />
        </span>
        <span
          class="flex flex-wrap items-center gap-x-1"
          data-testid="rf-range-banned"
          :data-value="inRange.banned"
          :data-lifted="inRange.lifted"
        >
          <span
            class="text-xl font-semibold tabular-nums"
            :class="inRange.banned > 0 ? 'text-error' : 'text-highlighted'"
          >ระงับ {{ formatInt(inRange.banned) }} · ปลด {{ formatInt(inRange.lifted) }}</span>
          <ReportsInfoHint id="rf-range-banned" :text="REPORT_HELP['rf-range-banned']!" />
        </span>
        <span class="mt-1 border-t border-default pt-1 text-xs text-muted">
          ตอนนี้ถูกระงับอยู่ <span :class="now.banned.count > 0 ? 'font-semibold text-error' : ''">{{ formatInt(now.banned.count) }}</span> · ดูรายการ →
        </span>
      </NuxtLink>
      <NuxtLink
        to="/ads-monitor"
        class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3 hover:bg-elevated/50"
        data-testid="rf-now-launching"
        :data-value="now.launching"
      >
        <span class="flex items-center gap-1 text-xs text-muted">
          <span>Advertiser กำลังยิง</span>
          <ReportsInfoHint id="rf-now-launching" :text="REPORT_HELP['rf-now-launching']!" />
        </span>
        <span
          class="flex flex-wrap items-center gap-x-1"
          data-testid="rf-range-launching"
          :data-value="inRange.launching"
        >
          <span class="text-xl font-semibold tabular-nums text-success">{{ formatInt(inRange.launching) }}<span class="ml-1 text-xs font-normal text-muted">advertiser</span></span>
          <ReportsInfoHint id="rf-range-launching" :text="REPORT_HELP['rf-range-launching']!" />
        </span>
        <span class="mt-1 border-t border-default pt-1 text-xs text-muted">ตอนนี้ {{ formatInt(now.launching) }} advertiser</span>
        <span
          v-if="now.notDelivering.count > 0"
          class="text-xs text-warning"
          data-testid="rf-now-launching-nd"
        >ตอนนี้ไม่ส่ง {{ formatInt(now.notDelivering.count) }}</span>
        <span v-else class="text-xs text-muted">ตอนนี้ build คิว {{ formatInt(now.builds.queued) }} · กำลังทำ {{ formatInt(now.builds.running) }}</span>
      </NuxtLink>
    </div>

    <div
      v-if="rows.length > 0"
      class="rounded-lg border border-warning/40 bg-warning/5 p-3"
      data-testid="rf-watch"
    >
      <h3 class="mb-2 flex items-center gap-1 text-xs font-semibold text-warning">
        <span>ต้องดู</span>
        <span class="font-normal text-muted">ตอนนี้</span>
        <ReportsInfoHint id="rf-watch" :text="REPORT_HELP['rf-watch']!" />
      </h3>
      <ul class="flex flex-col divide-y divide-default">
        <li
          v-for="row in rows"
          :key="row.key"
          class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm"
          data-testid="rf-watch-row"
          :data-kind="row.kind"
        >
          <UBadge
            :label="row.label"
            :color="KIND_COLOR[row.kind]"
            variant="subtle"
            size="sm"
          />
          <span class="min-w-0 truncate font-medium text-highlighted">{{ row.name }}</span>
          <span v-if="row.sub" class="min-w-0 truncate text-xs text-muted">{{ row.sub }}</span>
          <span class="min-w-0 truncate text-xs text-muted" data-testid="rf-watch-detail">{{ row.detail }}</span>
          <NuxtLink :to="row.to" class="ml-auto text-xs text-primary hover:underline">
            ไปแก้ →
          </NuxtLink>
        </li>
      </ul>
    </div>
  </section>
</template>
