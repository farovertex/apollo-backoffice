<script setup lang="ts">
/**
 * FEAT-069 — the shared header controls of `/reports/performance` (`rf`) and `/reports/dashboard` (`rd`)
 * (spec "UI behaviour → Shared"): `ReportsDateRange` · the GOD-only workspace `USelect` (`<p>-workspace`,
 * "ทุก workspace" = no param, options from the response's `scope.workspaces`) · the status line
 * `<p>-updated` "อัปเดต HH:MM · รีเฟรชเองทุก 5 นาที" with a pulsing dot while a request is in flight.
 *
 * Controlled like the picker: the page owns the URL; this component only emits.
 */
import type { PerfScopeWorkspace } from '#shared/types/report-performance'
import type { ReportRange, ReportRangeState } from '#shared/types/reports'

const props = defineProps<{
  prefix: 'rf' | 'rd'
  range: ReportRangeState
  pending: boolean
  /** GOD → the workspace picker is rendered */
  isGod: boolean
  workspaces: PerfScopeWorkspace[]
  workspaceId: string
  lastLoadedAt: number | null
}>()

const emit = defineEmits<{
  range: [patch: { range: ReportRange, from?: string, to?: string }]
  workspace: [id: string]
}>()

/** reka's Select refuses an empty-string item value → a sentinel for "every workspace" */
const ALL = '__all__'

const items = computed(() => {
  const list = props.workspaces.map(ws => ({
    label: ws.admin?.displayName && ws.admin.displayName !== ws.name
      ? `${ws.name ?? ws.id} · ${ws.admin.displayName}`
      : (ws.name ?? ws.id),
    value: ws.id
  }))
  // a workspace in the URL that the (not yet loaded) list does not have yet still shows as selected
  if (props.workspaceId && !list.some(item => item.value === props.workspaceId)) {
    list.push({ label: props.workspaceId, value: props.workspaceId })
  }
  return [{ label: 'ทุก workspace', value: ALL }, ...list]
})

const selected = computed({
  get: () => props.workspaceId || ALL,
  set: (value: string) => emit('workspace', value === ALL ? '' : value)
})

const updatedText = computed(() => perfUpdatedText(props.lastLoadedAt))
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <ReportsDateRange
      :prefix="prefix"
      :range="range.range"
      :from="range.from"
      :to="range.to"
      :pending="pending"
      @update="(patch) => emit('range', patch)"
    />

    <div v-if="isGod" :data-testid="`${prefix}-workspace`" :data-value="workspaceId">
      <USelect
        v-model="selected"
        :items="items"
        size="xs"
        class="w-48 max-w-full"
        aria-label="workspace"
        :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
      />
    </div>

    <p
      class="flex items-center gap-1.5 text-xs text-muted"
      :data-testid="`${prefix}-updated`"
      :data-loading="pending ? 'true' : 'false'"
    >
      <span
        class="size-2 shrink-0 rounded-full"
        :class="pending ? 'animate-pulse bg-primary' : 'bg-success'"
        aria-hidden="true"
      />
      <span>{{ updatedText }}</span>
    </p>
  </div>
</template>
