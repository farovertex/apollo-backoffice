<script setup lang="ts">
/**
 * TASK-adgroup-dayparting — the week grid of the ad-group template form ("เวลาที่กำหนด", like TikTok's).
 *
 * Rows = `days` (the API's `options.daypartingDays`, in its order), columns = `24 × 60 / granularity` cells
 * (`options.daypartingGranularityMinutes`, 48 at 30 min) with an hour label above every `60 / granularity` cells.
 * Nothing about days, labels or granularity is hard-coded here.
 *
 * - Cells are `<button aria-pressed>`: Space / Enter toggle (keyboard `click` has `detail === 0`).
 * - Pointer: pointerdown on a cell sets the paint value (`!cell`) and applies it, pointermove over other cells
 *   applies the same value, pointerup / cancel ends the stroke. The grid is `touch-action: none`, so a finger
 *   paints instead of scrolling; the wrapper still scrolls horizontally by its own scrollbar on a narrow screen.
 * - Per row `ทั้งวัน` / `ล้าง`, global `เลือกทั้งหมด` / `ล้างทั้งหมด`.
 * - Under the grid a live summary per day (`agt-dayparting-summary`) built from `cellsToRanges`.
 *
 * `v-model` is the cells (`day → boolean[]`); the form converts to / from ranges with `app/utils/dayparting.ts`.
 * Test ids: `agt-dayparting-grid`, `agt-dayparting-cell-<day>-<index>`, `agt-dayparting-row-all-<day>`,
 * `agt-dayparting-row-clear-<day>`, `agt-dayparting-all`, `agt-dayparting-clear`, `agt-dayparting-summary`.
 */
import type { OptionItem } from '#shared/types/ad-group-templates'
import type { DaypartingCells } from '~/utils/dayparting'
import { cellsPerDay, cellsToRanges, formatRanges } from '~/utils/dayparting'

const props = defineProps<{
  days: OptionItem[]
  granularity: number
  disabled?: boolean
  hint?: string
}>()

const cells = defineModel<DaypartingCells>({ required: true })

const size = computed(() => cellsPerDay(props.granularity))
const perHour = computed(() => Math.max(1, Math.round(60 / props.granularity)))
const hours = computed(() => Array.from({ length: Math.ceil(size.value / perHour.value) }, (_, h) => h))
const dayKeys = computed(() => props.days.map(d => d.value))
/** day label column | cells | row actions */
const columns = computed(() => `auto repeat(${size.value}, minmax(0.875rem, 1fr)) auto`)

function cellTime(index: number) {
  const minutes = index * props.granularity
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function isOn(day: string, index: number) {
  return cells.value[day]?.[index] === true
}

function setCell(day: string, index: number, value: boolean) {
  if (isOn(day, index) === value) return
  const row = [...(cells.value[day] ?? Array.from({ length: size.value }, () => false))]
  row[index] = value
  cells.value = { ...cells.value, [day]: row }
}

function setRow(day: string, value: boolean) {
  cells.value = { ...cells.value, [day]: Array.from({ length: size.value }, () => value) }
}

function setAll(value: boolean) {
  cells.value = Object.fromEntries(dayKeys.value.map(day => [day, Array.from({ length: size.value }, () => value)]))
}

// ── paint by drag ─────────────────────────────────────────────────────────────────────────────────────────────────
let paint: boolean | null = null

function cellOf(el: Element | null): { day: string, index: number } | null {
  const node = el?.closest<HTMLElement>('[data-day]')
  if (!node || node.dataset.day === undefined || node.dataset.index === undefined) return null
  return { day: node.dataset.day, index: Number(node.dataset.index) }
}

function onPointerDown(event: PointerEvent) {
  if (props.disabled || (event.pointerType === 'mouse' && event.button !== 0)) return
  const hit = cellOf(event.target as Element)
  if (!hit) return
  // a touch pointer is captured by the cell it started on — release it so pointermove sees the other cells
  const target = event.target as Element
  if (target.hasPointerCapture?.(event.pointerId)) target.releasePointerCapture(event.pointerId)
  paint = !isOn(hit.day, hit.index)
  setCell(hit.day, hit.index, paint)
  event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
  if (paint === null) return
  const hit = cellOf(document.elementFromPoint(event.clientX, event.clientY))
  if (hit) setCell(hit.day, hit.index, paint)
}

function endStroke() {
  paint = null
}

/** keyboard only: a pointer click was already handled by pointerdown (`detail` > 0) */
function onClick(event: MouseEvent, day: string, index: number) {
  if (props.disabled || event.detail !== 0) return
  setCell(day, index, !isOn(day, index))
}

const summary = computed(() => {
  const ranges = cellsToRanges(cells.value, dayKeys.value, props.granularity)
  return props.days.map(day => ({ day: day.value, label: day.label, text: formatRanges(ranges[day.value] ?? []) }))
})
</script>

<template>
  <div class="space-y-2" data-testid="agt-dayparting">
    <div class="flex flex-wrap items-center gap-2">
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        label="เลือกทั้งหมด"
        :disabled="disabled"
        data-testid="agt-dayparting-all"
        @click="setAll(true)"
      />
      <UButton
        size="xs"
        color="neutral"
        variant="outline"
        label="ล้างทั้งหมด"
        :disabled="disabled"
        data-testid="agt-dayparting-clear"
        @click="setAll(false)"
      />
    </div>

    <div class="overflow-x-auto rounded-md border border-default p-2">
      <div
        class="grid min-w-[44rem] touch-none select-none items-center gap-y-px"
        :style="{ gridTemplateColumns: columns }"
        role="group"
        aria-label="Dayparting"
        data-testid="agt-dayparting-grid"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="endStroke"
        @pointercancel="endStroke"
        @pointerleave="endStroke"
      >
        <!-- hour header -->
        <span />
        <span
          v-for="h in hours"
          :key="`h${h}`"
          class="text-center text-[10px] leading-4 text-muted"
          :style="{ gridColumn: `span ${perHour}` }"
        >{{ String(h).padStart(2, '0') }}</span>
        <span />

        <template v-for="day in days" :key="day.value">
          <span class="whitespace-nowrap pr-2 text-xs text-highlighted">{{ day.label }}</span>
          <button
            v-for="index in size"
            :key="`${day.value}-${index - 1}`"
            type="button"
            class="h-5 border border-default/60 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
            :class="[
              isOn(day.value, index - 1) ? 'bg-primary border-primary' : 'bg-elevated/40 hover:bg-elevated',
              (index - 1) % perHour === 0 ? 'border-l-default' : ''
            ]"
            :disabled="disabled"
            :aria-pressed="isOn(day.value, index - 1)"
            :aria-label="`${day.label} ${cellTime(index - 1)}`"
            :data-day="day.value"
            :data-index="index - 1"
            :data-testid="`agt-dayparting-cell-${day.value}-${index - 1}`"
            @click="onClick($event, day.value, index - 1)"
          />
          <span class="flex gap-1 pl-2">
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="ทั้งวัน"
              :disabled="disabled"
              :data-testid="`agt-dayparting-row-all-${day.value}`"
              @click="setRow(day.value, true)"
            />
            <UButton
              size="xs"
              color="neutral"
              variant="ghost"
              label="ล้าง"
              :disabled="disabled"
              :data-testid="`agt-dayparting-row-clear-${day.value}`"
              @click="setRow(day.value, false)"
            />
          </span>
        </template>
      </div>
    </div>

    <ul class="space-y-0.5 text-xs" data-testid="agt-dayparting-summary">
      <li
        v-for="row in summary"
        :key="row.day"
        class="text-muted"
        :data-day="row.day"
      >
        <span class="text-highlighted">{{ row.label }}</span>
        {{ row.text || '—' }}
      </li>
    </ul>
    <p v-if="hint" class="text-xs text-muted" data-testid="agt-dayparting-hint">
      {{ hint }}
    </p>
  </div>
</template>
