<script setup lang="ts">
/**
 * FEAT-084 — the raw breakdown line under a THB total that is not a `MoneyCell` (report tiles, the dashboard
 * balance tile, the top-ups summary): `THB 1,000 + USD 20.10` + a yellow `+50 ?` for the unconverted part.
 * Renders nothing when there is neither a foreign amount nor an unconverted one (a pure-THB total has no sub line),
 * unless `always` (the balance tile keeps its per-currency breakdown even when it is THB only).
 */
import type { MoneyByCurrency, MoneyUnconverted } from '#shared/types/fx'

const props = withDefaults(defineProps<{
  byCurrency?: MoneyByCurrency | null
  unconverted?: MoneyUnconverted
  separator?: string
  always?: boolean
  /** a ready-made breakdown text instead of `byCurrency` (balance tile: `100,000.00 THB · 700.00 USD`) */
  text?: string | null
}>(), { byCurrency: null, unconverted: null, separator: ' + ', always: false, text: null })

const line = computed(() => {
  if (props.text !== null) return props.text
  if (!props.always && !hasForeign(props.byCurrency)) return ''
  return byCurrencyText(props.byCurrency, props.separator)
})
const marker = computed(() => unconvertedMarker(props.unconverted))
</script>

<template>
  <span v-if="line || marker" class="text-[11px] text-muted tabular-nums" data-testid="money-sub">
    <span v-if="line">{{ line }}</span>
    <span
      v-if="marker"
      class="font-medium text-warning"
      :class="line ? 'ms-1' : ''"
      :title="unconvertedTitle(unconverted)"
      data-testid="money-unconverted"
    >{{ marker }}</span>
  </span>
</template>
