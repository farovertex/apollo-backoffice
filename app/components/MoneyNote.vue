<script setup lang="ts">
/**
 * FEAT-084 — the page badge that says which currency the money cells show (spec "UI behaviour", `money-note`):
 * - `thb` mode → "ทุกยอดเป็น THB · อัตรารายวัน 32.80–33.78" (min–max of the response's `fx.rates[]`);
 * - `account` mode → "ยอดเป็นสกุลของบัญชี · ≈ THB อัตราล่าสุด 33.78" (`latest` = the newest S block of the page).
 * Visible when `converted` says so, else when `fx.convertedRows > 0` (reports / ads-monitor); hidden otherwise.
 */
import type { FxReportBlock } from '#shared/types/fx'
import type { MoneyMode } from '~/utils/money'

const props = defineProps<{
  mode: MoneyMode
  fx?: FxReportBlock | null
  /** newest rate of the page's S blocks — the `account` mode text */
  latest?: { rate: number, day: string } | null
  /** explicit visibility for pages without an `fx` block (accounts / top-ups) */
  converted?: boolean
}>()

const visible = computed(() => props.converted ?? fxHasConverted(props.fx))

const text = computed(() => {
  if (props.mode === 'thb') {
    const range = fxRangeText(props.fx)
    if (range) return `ทุกยอดเป็น THB · อัตรารายวัน ${range}`
    if (props.latest) return `ทุกยอดเป็น THB · อัตราล่าสุด ${formatNumber(props.latest.rate, 2)}`
    return 'ทุกยอดเป็น THB'
  }
  return props.latest
    ? `ยอดเป็นสกุลของบัญชี · ≈ THB อัตราล่าสุด ${formatNumber(props.latest.rate, 2)}`
    : 'ยอดเป็นสกุลของบัญชี'
})

const title = computed(() => (props.latest ? `อัตราของวันที่ ${props.latest.day}` : undefined))
</script>

<template>
  <UBadge
    v-if="visible"
    color="neutral"
    variant="subtle"
    size="sm"
    icon="i-lucide-coins"
    class="max-w-full"
    data-testid="money-note"
    :data-mode="mode"
    :title="title"
  >
    <span class="truncate">{{ text }}</span>
  </UBadge>
</template>
