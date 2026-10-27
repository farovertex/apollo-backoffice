<script setup lang="ts">
/**
 * FEAT-069 — a sortable header cell (`aria-sort` on the `<th>`, the click target `<p>-<table>-sort-<col>` is a
 * button inside it). `sticky` pins the first column while the table scrolls horizontally inside its card.
 */
defineProps<{
  testid: string
  label: string
  sortState: 'ascending' | 'descending' | 'none'
  numeric?: boolean
  sticky?: boolean
}>()

defineEmits<{ sort: [] }>()
</script>

<template>
  <th
    scope="col"
    :aria-sort="sortState"
    class="bg-elevated p-0 text-xs font-medium text-muted"
    :class="sticky ? 'sticky left-0 z-[2]' : ''"
  >
    <button
      type="button"
      class="flex w-full items-center gap-1 px-3 py-2 uppercase hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
      :class="[numeric ? 'justify-end' : 'justify-start', sortState !== 'none' ? 'text-highlighted' : '']"
      :data-testid="testid"
      @click="$emit('sort')"
    >
      <span>{{ label }}</span>
      <span aria-hidden="true" class="w-2">{{ sortState === 'descending' ? '↓' : sortState === 'ascending' ? '↑' : '' }}</span>
    </button>
  </th>
</template>
