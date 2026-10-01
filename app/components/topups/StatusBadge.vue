<script setup lang="ts">
/**
 * FEAT-021 — the status badge of one round (spec table "สถานะของหนึ่งรอบ"). `ta-adv-topup-badge` in the
 * advertisers slide-over, `tp-row-status` in the `/topups` table; **every badge carries `data-status`**
 * (api-contract v1.1 §C). `paying` reads "กำลังจ่ายเงิน · <ชื่อคนจอง>".
 */
import type { TopupView } from '#shared/types/topups'

withDefaults(defineProps<{
  topup: TopupView | null
  testid?: string
  size?: 'sm' | 'md'
}>(), {
  testid: 'ta-adv-topup-badge',
  size: 'sm'
})
</script>

<template>
  <UBadge
    v-if="topup"
    :color="topupBadgeColor(topup)"
    variant="subtle"
    :size="size"
    class="whitespace-nowrap"
    :data-testid="testid"
    :data-status="topup.status"
  >
    {{ topupBadgeLabel(topup) }}
  </UBadge>
</template>
