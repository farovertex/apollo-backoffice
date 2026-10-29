<script setup lang="ts">
/**
 * FEAT-084 — one money cell = **main amount** (large) + **sub amount** (small, muted) (spec "UI behaviour", B5,
 * A12; proposal §0a / §7). The cell picks what goes on top from `mode`; it never converts anything itself.
 *
 * | case                                   | `thb` mode                       | `account` mode                   |
 * |----------------------------------------|----------------------------------|----------------------------------|
 * | foreign row, `thb` known               | `฿ 665` / `20.10 USD`            | `20.10 USD` / `≈ ฿ 665`          |
 * | THB-native row                         | `665.00 THB` (no sub)            | `665.00 THB` (no sub)            |
 * | foreign / unknown row, `thb` null      | `20.10 USD ?` (raw, yellow `?`)  | `20.10 USD` (no sub)             |
 * | `total` / `byCurrency` (aggregate)     | `฿ 1,665` / `THB 1,000 + USD 20.10` (both modes)                    |
 *
 * `estimated` → `≈` before the `฿` amount. `unconverted` → a trailing yellow `+50 ?` on the sub line with the
 * tooltip "ยอดที่ยังไม่รู้สกุล/ไม่มีอัตรา ไม่ได้รวม". Hover: `rateText` (R rows) or `amount × rate (day)` (S rows).
 *
 * Root: the parent's `data-testid` falls through; `data-mode`, `data-currency` (main currency), `data-main` (main
 * amount as a number), `data-thb` (THB amount or ''); inner `money-main`, `money-sub`, `money-unconverted`.
 */
import type { MoneyByCurrency, MoneyUnconverted } from '#shared/types/fx'
import type { MoneyMode } from '~/utils/money'

const props = withDefaults(defineProps<{
  native?: { amount: number | null | undefined, currency: string | null | undefined } | null
  thb?: number | null
  mode?: MoneyMode
  estimated?: boolean
  rate?: number | null
  day?: string | null
  rateText?: string | null
  /** aggregate rows: raw amounts per currency → sub `THB 1,000 + USD 20.10` */
  byCurrency?: MoneyByCurrency | null
  unconverted?: MoneyUnconverted
  /** forces the THB main amount with `฿` regardless of mode (footers, sticky totals, tiles) */
  total?: boolean
  /** decimals of the `฿` amount (default 0; cost metrics pass 2) */
  decimals?: number
  /** decimals of the raw amount (default 2) */
  nativeDecimals?: number
  /** a suffix after both amounts (`/วัน`) */
  suffix?: string
  /** `start` for left-aligned columns; default `end` (numbers) */
  align?: 'start' | 'end'
  /**
   * render the native currency code as a coloured `UBadge` (the accounts Balance column, 2026-10-16 rule); the
   * badge follows whichever line shows the native amount
   */
  currencyColor?: 'neutral' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' | null
  currencyTestid?: string
}>(), {
  native: null,
  thb: null,
  mode: 'thb',
  estimated: false,
  rate: null,
  day: null,
  rateText: null,
  byCurrency: null,
  unconverted: null,
  total: false,
  decimals: 0,
  nativeDecimals: 2,
  suffix: '',
  align: 'end',
  currencyColor: null,
  currencyTestid: 'money-currency'
})

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const nativeAmount = computed(() => num(props.native?.amount))
const nativeCurrency = computed(() => props.native?.currency ?? null)
const thbAmount = computed(() => num(props.thb))

/** aggregate cell: a total, or a report row that sums several accounts */
const aggregate = computed(() => props.total || props.byCurrency !== null)

const approx = computed(() => (props.estimated ? '≈ ' : ''))

const thbText = computed(() => `${approx.value}${formatThb(thbAmount.value, props.decimals)}${props.suffix}`)
const nativeText = computed(() => `${formatNative(nativeAmount.value, nativeCurrency.value, props.nativeDecimals)}${props.suffix}`)

/** `nativeOn` = which line shows the raw amount (for the optional currency badge) */
type Shape = { main: string, sub: string, currency: string, mainValue: number | null, missing: boolean, nativeOn?: 'main' | 'sub' }

const shape = computed<Shape>(() => {
  if (aggregate.value) {
    const codes = Object.keys(props.byCurrency ?? {})
    // one foreign currency only (a single-account report row) → `20.10 USD`; several → `THB 1,000 + USD 20.10`
    const sub = !hasForeign(props.byCurrency)
      ? ''
      : codes.length === 1
        ? formatNative(props.byCurrency![codes[0]!], codes[0], props.nativeDecimals)
        : byCurrencyText(props.byCurrency)
    return {
      main: thbAmount.value === null ? MONEY_DASH : thbText.value,
      sub,
      currency: 'THB',
      mainValue: thbAmount.value,
      missing: false
    }
  }
  const cur = nativeCurrency.value
  const amount = nativeAmount.value
  // THB-native: raw in both modes, never a sub line (A12)
  if (cur === 'THB') {
    return { main: nativeText.value, sub: '', currency: 'THB', mainValue: amount, missing: false, nativeOn: amount === null ? undefined : 'main' }
  }
  // nothing raw to show: a THB-only figure (e.g. a THB cost metric) or a dash
  if (amount === null) {
    return thbAmount.value !== null && props.mode === 'thb'
      ? { main: thbText.value, sub: '', currency: 'THB', mainValue: thbAmount.value, missing: false }
      : { main: MONEY_DASH, sub: '', currency: cur ?? '', mainValue: null, missing: false }
  }
  // foreign or unknown currency, no THB amount: raw with the yellow `?` marker in `thb` mode
  if (thbAmount.value === null) {
    return { main: nativeText.value, sub: '', currency: cur ?? '', mainValue: amount, missing: props.mode === 'thb', nativeOn: 'main' }
  }
  if (props.mode === 'thb') {
    return { main: thbText.value, sub: nativeText.value, currency: 'THB', mainValue: thbAmount.value, missing: false, nativeOn: 'sub' }
  }
  const rateSuffix = props.rate !== null && Number.isFinite(props.rate) ? ` (${formatNumber(props.rate, 2)})` : ''
  return {
    main: nativeText.value,
    sub: `≈ ${formatThb(thbAmount.value, props.decimals)}${props.suffix}${rateSuffix}`,
    currency: cur ?? '',
    mainValue: amount,
    missing: false,
    nativeOn: 'main'
  }
})

/** the number part of the raw amount, for the badge rendering (`700.00` + badge `USD`) */
const nativeNumber = computed(() => `${formatNumber(nativeAmount.value, props.nativeDecimals)}${props.suffix}`)
const badge = computed(() => (props.currencyColor && nativeCurrency.value ? props.currencyColor : null))

// a raw main amount with the `?` marker already says "not converted" — no second `+n ?` for the same money
const marker = computed(() => (shape.value.missing ? '' : unconvertedMarker(props.unconverted)))
const markerTitle = computed(() => unconvertedTitle(props.unconverted))

const hover = computed(() => {
  if (props.rateText) return props.rateText
  const text = rateHoverText(nativeAmount.value, nativeCurrency.value, props.rate, props.day)
  if (text) return props.estimated ? `${text} · อัตราประมาณ` : text
  return undefined
})

/** `data-thb`: the THB amount, the raw amount of a THB-native row, or '' */
const dataThb = computed(() => {
  if (thbAmount.value !== null) return String(thbAmount.value)
  if (!aggregate.value && nativeCurrency.value === 'THB' && nativeAmount.value !== null) return String(nativeAmount.value)
  return ''
})
</script>

<template>
  <span
    class="inline-flex min-w-0 flex-col leading-tight tabular-nums"
    :class="align === 'start' ? 'items-start text-left' : 'items-end text-right'"
    :data-mode="total ? 'thb' : mode"
    :data-currency="shape.currency"
    :data-main="shape.mainValue ?? ''"
    :data-thb="dataThb"
    :title="hover"
  >
    <span class="whitespace-nowrap" data-testid="money-main">
      <template v-if="badge && shape.nativeOn === 'main'">
        {{ nativeNumber }}
        <UBadge
          :color="badge"
          variant="subtle"
          size="sm"
          class="font-medium"
          :data-testid="currencyTestid"
          :data-currency="nativeCurrency"
        >{{ nativeCurrency }}</UBadge>
      </template>
      <template v-else>{{ shape.main }}</template><span
        v-if="shape.missing"
        class="ms-1 font-semibold text-warning"
        :title="UNCONVERTED_HINT"
        data-testid="money-missing"
      >?</span>
    </span>
    <span
      v-if="shape.sub || marker"
      class="text-xs whitespace-nowrap text-muted"
      data-testid="money-sub"
    >
      <template v-if="shape.sub && badge && shape.nativeOn === 'sub'">
        {{ nativeNumber }}
        <UBadge
          :color="badge"
          variant="subtle"
          size="xs"
          class="font-medium"
          :data-testid="currencyTestid"
          :data-currency="nativeCurrency"
        >{{ nativeCurrency }}</UBadge>
      </template>
      <span v-else-if="shape.sub">{{ shape.sub }}</span>
      <span
        v-if="marker"
        class="font-medium text-warning"
        :class="shape.sub ? 'ms-1' : ''"
        :title="markerTitle"
        data-testid="money-unconverted"
      >{{ marker }}</span>
    </span>
  </span>
</template>
