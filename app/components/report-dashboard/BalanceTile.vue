<script setup lang="ts">
/**
 * FEAT-084 (spec "UI behaviour → Dashboard", AC-18) — `rd-balance`, the "ยอดคงเหลือ" item of the dashboard hero:
 * line 1 `rd-balance-thb` "รวม ≈ ฿ 123,456" from `now.balanceThb.amount` (the `≈` only when `estimated`), line 2
 * `rd-balance-breakdown` the per-currency breakdown `100,000.00 THB · 700.00 USD` from `now.balance[]`, plus a
 * yellow `+n ?` for `balanceThb.unconverted[]`.
 *
 * An older API without the top-level `now` → the breakdown only, merged per currency from
 * `byWorkspace[].now.balance` (same-currency sums, no conversion), and no THB line — never a console error.
 */
import type { DashboardBalance, DashboardResponse, DashboardWorkspaceRow } from '#shared/types/report-dashboard'

const props = defineProps<{
  now?: DashboardResponse['now'] | null
  byWorkspace: DashboardWorkspaceRow[]
}>()

const balances = computed<DashboardBalance[]>(() => {
  if (props.now?.balance) return props.now.balance
  const merged = new Map<string | null, DashboardBalance>()
  for (const ws of props.byWorkspace) {
    for (const b of ws.now?.balance ?? []) {
      const cur = merged.get(b.currency)
      if (cur) {
        cur.amount += b.amount
        cur.accounts += b.accounts
      } else {
        merged.set(b.currency, { ...b })
      }
    }
  }
  return [...merged.values()]
})

const balanceThb = computed(() => props.now?.balanceThb ?? null)

const thbText = computed(() => {
  const b = balanceThb.value
  if (!b) return null
  return `รวม ${b.estimated ? '≈ ' : ''}${formatThb(b.amount)}`
})

/** `['100,000.00 THB ·', '700.00 USD']` — the breakdown line, one chunk per currency so it wraps between them */
const breakdownParts = computed(() => {
  if (balances.value.length === 0) return [REPORT_DASH]
  const parts = balances.value.map(b => formatNative(b.amount, b.currency))
  return parts.map((p, i) => (i < parts.length - 1 ? `${p} ·` : p))
})

const unconverted = computed(() => unconvertedFromList(balanceThb.value?.unconverted))

const accounts = computed(() => balances.value.reduce((acc, b) => acc + b.accounts, 0))
</script>

<template>
  <div
    class="col-span-2 flex min-w-0 flex-col lg:col-span-1"
    data-testid="rd-balance"
    :data-thb="balanceThb?.amount ?? ''"
    :data-estimated="balanceThb ? String(balanceThb.estimated) : ''"
  >
    <dt class="text-xs text-muted">
      ยอดคงเหลือ
    </dt>
    <dd
      v-if="thbText"
      class="truncate text-lg font-semibold tabular-nums"
      data-testid="rd-balance-thb"
      :title="accounts ? `${formatInt(accounts)} บัญชี` : undefined"
    >
      {{ thbText }}
    </dd>
    <dd class="flex min-w-0 flex-wrap items-baseline gap-x-1 text-xs text-muted tabular-nums">
      <!-- the per-currency list wraps between currencies (one item never breaks) instead of being cut -->
      <span
        class="flex min-w-0 flex-wrap gap-x-1"
        :class="thbText ? '' : 'text-lg font-semibold text-highlighted'"
        data-testid="rd-balance-breakdown"
      >
        <span v-for="(part, i) in breakdownParts" :key="i" class="whitespace-nowrap">{{ part }}</span>
      </span>
      <span
        v-if="unconverted"
        class="font-medium text-warning"
        :title="unconvertedTitle(unconverted)"
        data-testid="money-unconverted"
      >{{ unconvertedMarker(unconverted) }}</span>
    </dd>
  </div>
</template>
