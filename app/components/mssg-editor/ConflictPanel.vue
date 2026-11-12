<script setup lang="ts">
/**
 * FEAT-101 (AC-12, AC-13) — the apply found values on mssg that changed since the draft began: nothing was written.
 * Each item: step + Thai field label, "ค่าบน mssg" vs "ร่างของคุณ" (`gone` = the object no longer exists on mssg).
 * Contract v1 `POST …/draft/resolve { take }` resolves **all** items at once, so the panel has one pair of buttons:
 * "ใช้ค่าจาก mssg" (`take: live`) / "ใช้ค่าของฉัน" (`take: mine`), then the user saves again.
 * Test ids: `me-conflict`, `me-conflict-item` (`data-path`, `data-kind`, `data-step`), `me-conflict-take-live`,
 * `me-conflict-take-mine`.
 */
import type { MssgConflict, MssgOp } from '#shared/types/mssg-sites'

const props = defineProps<{
  conflict: MssgConflict
  ops: MssgOp[]
  busy: boolean
  disabled: boolean
}>()

const emit = defineEmits<{ take: [take: 'live' | 'mine'], goStep: [n: number] }>()

const items = computed(() => props.conflict.items.map(item => ({
  ...item,
  step: mssgConflictStep(item, props.ops),
  label: mssgFieldLabel(item.path)
})))
</script>

<template>
  <section
    role="alert"
    class="flex flex-col gap-3 rounded-lg border border-warning/50 bg-warning/10 p-3 sm:p-4"
    data-testid="me-conflict"
    :data-count="items.length"
  >
    <div class="flex flex-col gap-1">
      <span class="font-semibold text-warning">ค่าบน mssg เปลี่ยนไประหว่างที่คุณแก้ร่าง · ยังไม่ได้บันทึกอะไร</span>
      <span class="text-sm text-toned">เลือกว่าจะใช้ค่าไหน แล้วกด "บันทึก" อีกครั้ง</span>
    </div>
    <ul class="flex flex-col gap-2">
      <li
        v-for="(item, i) in items"
        :key="`${i}-${item.path}`"
        class="flex flex-col gap-1.5 rounded-md border border-default bg-default p-2.5 text-sm"
        data-testid="me-conflict-item"
        :data-path="item.path"
        :data-kind="item.kind"
        :data-step="item.step"
      >
        <span class="flex flex-wrap items-center gap-2">
          <UButton
            :label="`ขั้นที่ ${item.step} · ${mssgStepTitle(item.step)}`"
            color="neutral"
            variant="link"
            size="xs"
            class="p-0"
            @click="emit('goStep', item.step)"
          />
          <span class="font-medium break-words text-highlighted">{{ item.label }}</span>
        </span>
        <span v-if="item.kind === 'gone'" class="break-words text-muted">ส่วนนี้ถูกลบไปแล้วบน mssg</span>
        <div v-else class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-xs text-muted">ค่าบน mssg</span>
            <span class="break-words text-toned" data-testid="me-conflict-live">{{ mssgValueText(item.live) }}</span>
          </span>
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-xs text-muted">ร่างของคุณ</span>
            <span class="break-words text-highlighted" data-testid="me-conflict-mine">{{ mssgValueText(item.mine) }}</span>
          </span>
        </div>
      </li>
    </ul>
    <div class="flex flex-wrap gap-2">
      <UButton
        label="ใช้ค่าจาก mssg"
        color="neutral"
        variant="outline"
        size="sm"
        :loading="busy"
        :disabled="disabled || busy"
        data-testid="me-conflict-take-live"
        @click="emit('take', 'live')"
      />
      <UButton
        label="ใช้ค่าของฉัน"
        color="warning"
        variant="solid"
        size="sm"
        :loading="busy"
        :disabled="disabled || busy"
        data-testid="me-conflict-take-mine"
        @click="emit('take', 'mine')"
      />
    </div>
  </section>
</template>
