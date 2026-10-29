<script setup lang="ts">
/**
 * FEAT-084 — "แสดงเป็น: THB | สกุลของบัญชี", the per-page money mode switch of the account pages (spec "UI
 * behaviour"). Stateless: the page owns the mode through `useMoneyMode(pageKey)` and passes it in. On mobile the
 * label is hidden and the second button reads "บัญชี".
 */
import type { MoneyMode } from '~/utils/money'

defineProps<{ mode: MoneyMode }>()
const emit = defineEmits<{ 'update:mode': [MoneyMode] }>()
</script>

<template>
  <div
    class="inline-flex shrink-0 items-center gap-1.5"
    data-testid="money-mode"
    :data-mode="mode"
    role="group"
    aria-label="แสดงยอดเงินเป็น"
  >
    <span class="hidden text-xs text-muted sm:inline">แสดงเป็น:</span>
    <UFieldGroup size="xs">
      <UButton
        label="THB"
        :color="mode === 'thb' ? 'primary' : 'neutral'"
        :variant="mode === 'thb' ? 'solid' : 'outline'"
        :aria-pressed="mode === 'thb'"
        data-testid="money-mode-thb"
        @click="emit('update:mode', 'thb')"
      />
      <UButton
        :color="mode === 'account' ? 'primary' : 'neutral'"
        :variant="mode === 'account' ? 'solid' : 'outline'"
        :aria-pressed="mode === 'account'"
        aria-label="สกุลของบัญชี"
        data-testid="money-mode-account"
        @click="emit('update:mode', 'account')"
      >
        <span class="hidden sm:inline">สกุลของบัญชี</span>
        <span class="sm:hidden">บัญชี</span>
      </UButton>
    </UFieldGroup>
  </div>
</template>
