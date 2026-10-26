<script setup lang="ts">
/**
 * FEAT-065 — the **one** date-range picker of every report page (spec "UI behaviour → The shared control",
 * api-contract.md §6.3). One trigger button opens a popover with the five shortcuts + `กำหนดเอง`, the two
 * native `type=date` inputs and a range calendar bound to them.
 *
 * Fully **controlled**: the page owns the URL (and its own `setQuery` mechanics), this component owns
 * nothing but the open/closed state. Every interaction emits `update` with the next range state; the page
 * writes it into the URL and the new props come back in. There is no local copy of the dates, so a back
 * button, a shared link or a page-side reset is reflected immediately.
 *
 * The `prefix` makes the test ids per page (`rp` / `rs` / `rb` / `ru` / `am`): `<p>-range`,
 * `<p>-range-trigger`, `<p>-range-panel`, `<p>-range-<key>` (×6), `<p>-from`, `<p>-to`,
 * `<p>-range-invalid`. The two inputs are the deterministic surface for specs (spec A1); the `UCalendar` is
 * a convenience bound to the same values (pattern: `app/components/home/HomeDateRangePicker.vue`, demo code
 * that is not reused).
 *
 * Validation and labels come from `app/utils/report-range.ts` — never re-implemented here.
 */
import { CalendarDate, type DateValue } from '@internationalized/date'
import type { ReportRange, ReportRangeKey, ReportRangeState } from '#shared/types/reports'

const props = withDefaults(defineProps<{
  /** test-id prefix of the hosting page */
  prefix: 'rp' | 'rs' | 'rb' | 'ru' | 'am'
  range: ReportRange
  /** `''` when absent — only `custom` ever carries a pair */
  from: string
  to: string
  /** the page is loading: a spinner on the trigger, nothing is disabled */
  pending?: boolean
}>(), { pending: false })

const emit = defineEmits<{
  /** next range state; `from`/`to` are `undefined` when the key has none */
  update: [patch: { range: ReportRange, from?: string, to?: string }]
}>()

const open = ref(false)
/** two calendar months from `sm` up, one on a phone (spec "Mobile 390x844") */
const wide = useMediaQuery('(min-width: 640px)')

const state = computed<ReportRangeState>(() => ({ range: props.range, from: props.from, to: props.to }))
const invalid = computed(() => reportRangeInvalid(state.value))
const triggerLabel = computed(() => rangeTriggerLabel(state.value))

/** a shortcut drops the pair and closes the panel */
function pickKey(key: ReportRangeKey) {
  emit('update', { range: key, from: undefined, to: undefined })
  open.value = false
}

/**
 * `กำหนดเอง` keeps whatever pair the URL already has (echoing the props is what "keeps" means here) and
 * leaves the panel open so the next click can be a date; with no pair the hint shows and nothing is sent.
 */
function pickCustom() {
  emit('update', { range: 'custom', from: props.from || undefined, to: props.to || undefined })
}

/** typing in either input switches to `custom` — the other side keeps its current value */
function setSide(side: 'from' | 'to', value: string) {
  const next = {
    range: 'custom' as const,
    from: props.from || undefined,
    to: props.to || undefined
  }
  next[side] = value || undefined
  emit('update', next)
}

// ── calendar ↔ the two inputs ────────────────────────────────────────────────────────────────────────────────────────
function toCalendarDate(day: string): CalendarDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  return match ? new CalendarDate(Number(match[1]), Number(match[2]), Number(match[3])) : undefined
}

function toDay(value: { year: number, month: number, day: number } | null | undefined): string {
  if (!value) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`
}

/**
 * What the calendar shows: the pair, but only while it is ordered — an impossible pair (`to < from`, which
 * the hint already explains) is not a valid range model, so only the start is shown.
 */
const calendarRange = computed(() => {
  const start = toCalendarDate(props.from)
  const end = toCalendarDate(props.to)
  if (start && end && end.compare(start) < 0) return { start, end: undefined }
  return { start, end }
})

/**
 * One-way binding on purpose (no `v-model`): `UCalendar`/reka re-emits its model whenever it normalises what
 * we gave it — e.g. after `to` is typed before `from`, the range is incomplete for the calendar and it would
 * emit the pair back without the end, silently dropping `to` from the URL (seen in the browser loop). An
 * emission equal to what we are showing is therefore ignored; anything else is a real click: the start alone
 * (hint, no request), then the pair (request). The same day twice is a single day.
 */
function onCalendar(value: { start?: DateValue, end?: DateValue } | null) {
  const from = toDay(value?.start)
  const to = toDay(value?.end)
  const shown = calendarRange.value
  if (from === toDay(shown.start) && to === toDay(shown.end)) return
  emit('update', { range: 'custom', from: from || undefined, to: to || undefined })
}

const SHORTCUTS = computed(() => [...RANGE_KEYS, 'custom' as const])
</script>

<template>
  <div
    :data-testid="`${prefix}-range`"
    :data-range="range"
    :data-from="from"
    :data-to="to"
    :data-pending="pending ? 'true' : 'false'"
  >
    <UPopover v-model:open="open" :modal="false" :content="{ align: 'start' }">
      <UButton
        :label="triggerLabel"
        icon="i-lucide-calendar"
        :size="prefix === 'ru' ? 'sm' : 'xs'"
        color="neutral"
        variant="outline"
        aria-haspopup="dialog"
        :aria-expanded="open"
        class="group max-w-40 sm:max-w-none"
        :ui="{ label: 'truncate' }"
        :data-testid="`${prefix}-range-trigger`"
      >
        <template #trailing>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-4 shrink-0 text-dimmed transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
        </template>
      </UButton>

      <template #content>
        <div
          :data-testid="`${prefix}-range-panel`"
          role="group"
          aria-label="ช่วงเวลา"
          class="flex max-w-[calc(100vw-2rem)] flex-col gap-2 p-2 sm:flex-row sm:items-stretch sm:gap-3"
        >
          <!-- shortcuts: a wrapping row on a phone, a column from `sm` up -->
          <div class="flex flex-wrap gap-1 sm:flex-col sm:flex-nowrap sm:border-r sm:border-default sm:pr-3">
            <UButton
              v-for="key in SHORTCUTS"
              :key="key"
              :label="RANGE_LABEL[key]"
              size="xs"
              :color="range === key ? 'primary' : 'neutral'"
              :variant="range === key ? 'solid' : 'outline'"
              :aria-pressed="range === key"
              class="sm:justify-start"
              :data-testid="`${prefix}-range-${key}`"
              @click="key === 'custom' ? pickCustom() : pickKey(key)"
            />
          </div>

          <!-- custom block: always rendered, enabled in every mode — typing switches to `custom` -->
          <div class="flex min-w-0 flex-col gap-2">
            <div class="flex items-center gap-1.5">
              <UInput
                type="date"
                :model-value="from"
                size="xs"
                class="min-w-0 flex-1 sm:w-40 sm:flex-none"
                aria-label="ตั้งแต่วันที่"
                :data-testid="`${prefix}-from`"
                @update:model-value="(v: string | number) => setSide('from', String(v))"
              />
              <span class="text-sm text-muted">→</span>
              <UInput
                type="date"
                :model-value="to"
                size="xs"
                class="min-w-0 flex-1 sm:w-40 sm:flex-none"
                aria-label="ถึงวันที่"
                :data-testid="`${prefix}-to`"
                @update:model-value="(v: string | number) => setSide('to', String(v))"
              />
            </div>

            <UCalendar
              :model-value="calendarRange"
              range
              :number-of-months="wide ? 2 : 1"
              :size="wide ? 'md' : 'sm'"
              class="p-0"
              @update:model-value="onCalendar"
            />

            <p
              v-if="range === 'custom' && invalid"
              class="text-sm text-error"
              :data-testid="`${prefix}-range-invalid`"
            >
              {{ invalid }}
            </p>
          </div>
        </div>
      </template>
    </UPopover>
  </div>
</template>
