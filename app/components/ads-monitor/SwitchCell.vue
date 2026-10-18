<script setup lang="ts">
/**
 * FEAT-056 — `am-switch` (spec "UI behaviour" → On/off cell; AC-22). Three mutually exclusive renderings:
 *
 * 1. **pending** (`row.optPending != null`, either from the API or from our own accepted 202): the switch is
 *    disabled, sits at the pending **target** (not at the stale `opt`) and is followed by `am-switch-pending`
 *    "กำลังเปิด…" / "กำลังปิด…" with a spinner. Reload-safe: a row that arrives with `optPending` looks the same.
 * 2. **error** (`row.optError != null`, no pending): the switch shows the real `opt` again and a red
 *    `am-switch-error` button repeats the failed target when pressed.
 * 3. **idle**: `checked = opt === 0` (TikTok: 0 = on, 1 = off). Disabled with a tooltip when the API says
 *    `switchable.ok === false` — the reason text comes from the API, the BO never recomputes the rule.
 *
 * There is **no confirm dialog** (human decision, brief §0.4): the click posts straight away.
 */
import type { MonitorRow, ToggleTarget } from '#shared/types/ads-monitor'

const props = defineProps<{ row: MonitorRow }>()
const emit = defineEmits<{ toggle: [target: ToggleTarget] }>()

const pending = computed(() => props.row.optPending)
const failure = computed(() => (pending.value ? null : props.row.optError))

/** while pending the knob shows where the job is going, otherwise the value TikTok last reported */
const checked = computed(() => (pending.value ? pending.value.target === 'on' : props.row.opt === 0))
const disabled = computed(() => pending.value !== null || !props.row.switchable.ok)
const tooltip = computed(() => (pending.value ? null : props.row.switchable.reason))
const ariaLabel = computed(() => `เปิด/ปิด ${props.row.name ?? props.row.id}`)
const pendingText = computed(() => (pending.value?.target === 'on' ? 'กำลังเปิด…' : 'กำลังปิด…'))
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-1"
    data-testid="am-switch"
    :data-level="row.level"
    :data-id="row.id"
    :data-opt="row.opt === null ? '' : String(row.opt)"
    :data-state="pending ? 'pending' : failure ? 'error' : 'idle'"
    :data-switchable="row.switchable.ok ? 'true' : 'false'"
  >
    <UTooltip :text="tooltip ?? ''" :disabled="!tooltip">
      <span class="inline-flex">
        <USwitch
          :model-value="checked"
          :disabled="disabled"
          :aria-label="ariaLabel"
          data-testid="am-switch-input"
          @update:model-value="(v: boolean) => emit('toggle', v ? 'on' : 'off')"
        />
      </span>
    </UTooltip>

    <span
      v-if="pending"
      class="flex items-center gap-1 text-xs whitespace-nowrap text-muted"
      data-testid="am-switch-pending"
      :data-target="pending.target"
    >
      <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
      {{ pendingText }}
    </span>

    <UButton
      v-else-if="failure"
      color="error"
      variant="subtle"
      size="xs"
      icon="i-lucide-rotate-ccw"
      :label="`เปลี่ยนไม่สำเร็จ: ${failure.reason}`"
      :title="`กดเพื่อลองใหม่ (${failure.target === 'on' ? 'เปิด' : 'ปิด'})`"
      class="max-w-44 justify-start text-left"
      :ui="{ label: 'truncate' }"
      data-testid="am-switch-error"
      :data-target="failure.target"
      @click="emit('toggle', failure.target)"
    />
  </div>
</template>
