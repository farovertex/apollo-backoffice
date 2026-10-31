<script setup lang="ts">
/**
 * FEAT-089 — the header controls of `/reports/posts`: `ReportsDateRange` (`rp-range`) · GOD-only workspace
 * `USelect` (`rp-workspace`) · prefix `USelect` (`rp-prefix`, options from the response's `prefixes[]`,
 * "ทั้งหมด" = no param) · the "เฉพาะแถวที่ข้อมูลพอ" switch (`rp-enough-only`) · the `rp-updated` status line.
 * Controlled — the page owns the URL, this component only emits (same contract as
 * `report-performance/Toolbar.vue`).
 */
import type { PerfScopeWorkspace } from '#shared/types/report-performance'
import type { ReportRange, ReportRangeState } from '#shared/types/reports'

const props = defineProps<{
  range: ReportRangeState
  pending: boolean
  isGod: boolean
  workspaces: PerfScopeWorkspace[]
  workspaceId: string
  prefixes: string[]
  prefix: string
  enoughOnly: boolean
  lastLoadedAt: number | null
}>()

const emit = defineEmits<{
  range: [patch: { range: ReportRange, from?: string, to?: string }]
  workspace: [id: string]
  prefix: [value: string]
  enoughOnly: [on: boolean]
}>()

/** reka's Select refuses an empty-string item value → sentinels for "every workspace" / "every prefix" */
const ALL_WORKSPACE = '__all__'
const ALL_PREFIX = '__all__'

const workspaceItems = computed(() => {
  const list = props.workspaces.map(ws => ({
    label: ws.admin?.displayName && ws.admin.displayName !== ws.name
      ? `${ws.name ?? ws.id} · ${ws.admin.displayName}`
      : (ws.name ?? ws.id),
    value: ws.id
  }))
  if (props.workspaceId && !list.some(item => item.value === props.workspaceId)) {
    list.push({ label: props.workspaceId, value: props.workspaceId })
  }
  return [{ label: 'ทุก workspace', value: ALL_WORKSPACE }, ...list]
})

const selectedWorkspace = computed({
  get: () => props.workspaceId || ALL_WORKSPACE,
  set: (value: string) => emit('workspace', value === ALL_WORKSPACE ? '' : value)
})

const prefixItems = computed(() => [
  { label: 'ทั้งหมด', value: ALL_PREFIX },
  ...props.prefixes.map(p => ({ label: p, value: p }))
])

const selectedPrefix = computed({
  get: () => props.prefix || ALL_PREFIX,
  set: (value: string) => emit('prefix', value === ALL_PREFIX ? '' : value)
})

const updatedText = computed(() => perfUpdatedText(props.lastLoadedAt))
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <ReportsDateRange
      prefix="rp"
      :range="range.range"
      :from="range.from"
      :to="range.to"
      :pending="pending"
      @update="(patch) => emit('range', patch)"
    />

    <div v-if="isGod" data-testid="rp-workspace" :data-value="workspaceId">
      <USelect
        v-model="selectedWorkspace"
        :items="workspaceItems"
        size="xs"
        class="w-48 max-w-full"
        aria-label="workspace"
        :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
      />
    </div>

    <div data-testid="rp-prefix" :data-value="prefix">
      <USelect
        v-model="selectedPrefix"
        :items="prefixItems"
        size="xs"
        class="w-36 max-w-full"
        aria-label="prefix"
        :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
      />
    </div>

    <USwitch
      :model-value="enoughOnly"
      label="เฉพาะแถวที่ข้อมูลพอ"
      data-testid="rp-enough-only"
      @update:model-value="(v: boolean) => emit('enoughOnly', v)"
    />

    <p
      class="flex items-center gap-1.5 text-xs text-muted"
      data-testid="rp-updated"
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
