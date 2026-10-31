<script setup lang="ts">
/**
 * FEAT-093 — `am-selection-bar`: the multi-select action bar of the ad-group / ad tabs (api-contract.md v1 §6,
 * spec "UI behaviour" → Selection bar). Rendered by `pages/ads-monitor.vue` above the table only while at least
 * one row is ticked; the request, the optimistic override and the toasts all live in the page next to
 * `confirmDeleteMany()`, so this component only shows the count and emits two intents.
 *
 * Wraps to two lines at 390 px (`flex-wrap`), so the count stays readable while the buttons drop below it.
 */
const props = defineProps<{
  /** how many rows are ticked on the current page */
  count: number
}>()

const emit = defineEmits<{
  /** "ลบที่เลือก" pressed — the page opens the bulk confirm modal */
  delete: []
  /** "ล้าง" pressed — the page clears the selection */
  clear: []
}>()

const countText = computed(() => `เลือก ${props.count} รายการ`)
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-2 rounded-lg border border-default bg-elevated/60 px-3 py-2"
    data-testid="am-selection-bar"
  >
    <span class="text-sm font-medium text-highlighted" data-testid="am-selection-count">
      {{ countText }}
    </span>
    <div class="flex flex-wrap items-center gap-2 sm:ms-auto">
      <UButton
        label="ลบที่เลือก"
        icon="i-lucide-trash-2"
        color="error"
        variant="solid"
        size="sm"
        data-testid="am-bulk-delete"
        @click="emit('delete')"
      />
      <UButton
        label="ล้าง"
        color="neutral"
        variant="ghost"
        size="sm"
        data-testid="am-selection-clear"
        @click="emit('clear')"
      />
    </div>
  </div>
</template>
