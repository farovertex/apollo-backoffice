<script setup lang="ts">
/**
 * FEAT-101 — left nav of the editor (design `stepsDef`, D11): the 5 steps with ✓ / • and "▲ ตั้งค่าแล้ว / ▼ ยังไม่ครบ"
 * from the API's readiness, a red count when the step has field errors or conflicts, then "ความพร้อม N%" + bar +
 * "ยังขาด: …". Test ids: `me-steps`, `me-step-<n>` (`data-done`, `data-current`, `data-errors`), `me-readiness`
 * (`data-percent`), `me-readiness-missing`.
 */
import type { MssgReadiness, MssgStepNo } from '#shared/types/mssg-sites'

const props = defineProps<{
  current: MssgStepNo
  readiness: MssgReadiness | null
  /** field errors + conflicts per step */
  problems: Partial<Record<MssgStepNo, number>>
}>()

const emit = defineEmits<{ select: [n: MssgStepNo] }>()

const steps = computed(() => MSSG_EDITOR_STEPS.map((d) => {
  const done = !!props.readiness?.steps?.[String(d.n) as '1']
  return { ...d, done, problems: props.problems[d.n] ?? 0 }
}))
const percent = computed(() => props.readiness?.percent ?? 0)
const missing = computed(() => (props.readiness?.missing ?? []).map(n => mssgStepTitle(n)))
</script>

<template>
  <nav aria-label="หมวดการตั้งค่า" class="flex min-w-0 flex-col gap-1" data-testid="me-steps">
    <button
      v-for="st in steps"
      :key="st.n"
      type="button"
      class="flex min-h-13 w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-start transition-colors hover:bg-elevated"
      :class="st.n === current ? 'bg-elevated' : ''"
      :aria-current="st.n === current ? 'step' : undefined"
      :data-testid="`me-step-${st.n}`"
      :data-done="st.done ? 'true' : 'false'"
      :data-current="st.n === current ? 'true' : 'false'"
      :data-errors="st.problems"
      @click="emit('select', st.n)"
    >
      <span class="flex min-w-0 flex-1 flex-col gap-px">
        <span class="text-sm font-medium break-words text-highlighted">{{ st.n }}. {{ st.title }}</span>
        <span class="text-xs break-words text-muted">{{ st.sub }}</span>
        <span class="text-xs" :class="st.done ? 'text-success' : 'text-error'">{{ st.done ? '▲ ตั้งค่าแล้ว' : '▼ ยังไม่ครบ' }}</span>
      </span>
      <UBadge
        v-if="st.problems"
        :label="String(st.problems)"
        color="error"
        variant="solid"
        size="sm"
        :aria-label="`มี ${st.problems} จุดที่ต้องแก้`"
      />
      <span aria-hidden="true" class="text-sm" :class="st.done ? 'text-success' : 'text-error'">{{ st.done ? '✓' : '•' }}</span>
    </button>

    <div
      class="mt-2.5 flex flex-col gap-1.5 rounded-lg border border-default p-3"
      data-testid="me-readiness"
      :data-percent="percent"
    >
      <span class="text-sm text-toned">ความพร้อม <strong class="text-highlighted">{{ percent }}%</strong></span>
      <UProgress :model-value="percent" size="sm" aria-hidden="true" />
      <span v-if="missing.length" class="text-xs break-words text-muted" data-testid="me-readiness-missing">ยังขาด: {{ missing.join(', ') }}</span>
    </div>
  </nav>
</template>
