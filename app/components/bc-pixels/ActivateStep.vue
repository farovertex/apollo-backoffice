<script setup lang="ts">
/**
 * FEAT-102 — step 5 "ทำให้เขียว" (spec "UI behaviour → Panel" 5, AC-26; api-contract §5.1, §7.2–§7.4 run ids).
 * Needs step 3 (step 4 is not a precondition).
 *  - no run yet: `bpx-run-start` ("เริ่มทำให้เขียว") + `bpx-run-note` → exactly one `POST …/runs` with `{}` (`presses`
 *    omitted, the API default applies) → 202 `{ run }`.
 *  - a run: `RunCard` (`bpx-run`); stop / resume / retry → one `POST …/runs/:runId/<action>` → 200 `{ run }`.
 *  - event Active: `bpx-run-active` "เขียวแล้ว (Active) · HH:mm" + `bpx-run-verify` ("ตรวจสถานะอีกครั้ง") → one
 *    `POST …/runs { verifyOnly: true }`, offered while no run is open.
 * Every answer's `run` goes to the panel (`run`), which shows it at once and re-reads the pixel (steps, `busy`).
 * A 409 shows the API's `error` (`bpx-run-error`), toasts and re-reads. One toast per run end: when a run the panel
 * saw open turns `completed`, by outcome (success / warning / error) — never for a run that was already completed
 * when the panel opened.
 */
import type { PixelRunBody, PixelRunResponse, PixelView, RunView } from '#shared/types/bc-pixels'

const props = defineProps<{
  pixel: PixelView
}>()

const emit = defineEmits<{
  run: [run: RunView]
  reload: []
}>()

const api = useApi()
const toast = useToast()

const run = computed(() => props.pixel.latestRun)
const runOpen = computed(() => !!run.value && run.value.status !== 'completed')
const isActive = computed(() => props.pixel.eventStatus === 'active')

type Busy = 'start' | 'verify' | 'stop' | 'resume' | 'retry'
const busy = ref<Busy | null>(null)
const refusal = ref<string | null>(null)

watch(() => props.pixel.id, () => {
  refusal.value = null
})

// ── one toast per run end ────────────────────────────────────────────────────────────────────────────────────────────
// keyed on id + status: a retry keeps the run id, so each running → completed edge toasts once
watch(
  () => (run.value ? `${run.value.id}:${run.value.status}` : ''),
  (_key, oldKey) => {
    const r = run.value
    if (!r || r.status !== 'completed' || !oldKey) return
    const [oldId, oldStatus] = oldKey.split(':')
    if (oldId !== r.id || oldStatus === 'completed') return
    const t = bcPixelRunEndToast(r)
    toast.add({ title: t.title, description: [props.pixel.name, t.detail].filter(Boolean).join(' · '), color: t.color })
  }
)

// ── requests ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function call(kind: Busy, path: string, body?: PixelRunBody) {
  if (busy.value) return
  busy.value = kind
  refusal.value = null
  try {
    const res = await api<PixelRunResponse>(`/bc-pixels/${encodeURIComponent(props.pixel.id)}/${path}`, {
      method: 'POST',
      retry: 0,
      ...(body ? { body } : {})
    })
    if (kind === 'start') toast.add({ title: BC_PIXEL_TOAST.runStarted, description: props.pixel.name, color: 'info' })
    else if (kind === 'verify') toast.add({ title: BC_PIXEL_TOAST.runStarted, description: `${props.pixel.name} · ตรวจสถานะอย่างเดียว`, color: 'info' })
    emit('run', res.run)
  } catch (e) {
    const f = bcPixelFailure(e, 'ทำรายการนี้ไม่สำเร็จ')
    refusal.value = f.message
    toast.add({ title: 'ทำให้เขียวไม่ได้', description: f.message, color: 'error' })
    emit('reload')
  } finally {
    busy.value = null
  }
}

function start() {
  void call('start', 'runs', {})
}
function verifyAgain() {
  void call('verify', 'runs', { verifyOnly: true })
}
function runAction(action: 'stop' | 'resume' | 'retry') {
  const r = run.value
  if (!r) return
  void call(action, `runs/${encodeURIComponent(r.id)}/${action}`)
}

/** start is offered only before the first run; afterwards the card's retry / resume take over */
const showStart = computed(() => !!props.pixel.event && !isActive.value && !run.value)
const startDisabled = computed(() =>
  props.pixel.superseded || !props.pixel.installed || props.pixel.siteGone || !!busy.value
)
const startBlockedText = computed(() => {
  if (props.pixel.superseded) return null
  if (props.pixel.siteGone) return BC_PIXEL_CONFLICT_TEXT.siteGone
  if (!props.pixel.installed) return BC_PIXEL_CONFLICT_TEXT.notInstalled
  return null
})
const cardBusy = computed(() => (busy.value === 'stop' || busy.value === 'resume' || busy.value === 'retry' ? busy.value : null))
</script>

<template>
  <div class="space-y-3">
    <p v-if="!pixel.event" class="text-muted">
      ต้องสร้าง event กดปุ่มก่อน (ขั้นที่ 3)
    </p>

    <div
      v-if="isActive"
      class="flex flex-wrap items-center gap-2 rounded-md bg-success/10 px-2.5 py-2"
    >
      <p class="flex min-w-0 flex-1 items-center gap-1.5 font-medium text-success" data-testid="bpx-run-active">
        <UIcon name="i-lucide-badge-check" class="size-4 shrink-0" />
        <span>{{ BC_PIXEL_RUN_OUTCOME_TEXT.active }} · {{ bcPixelTime(pixel.event?.activeAt ?? run?.finishedAt) || '—' }}</span>
      </p>
      <UButton
        v-if="!runOpen"
        :label="BC_PIXEL_TEXT.runVerify"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        size="xs"
        :loading="busy === 'verify'"
        :disabled="pixel.superseded || !!busy"
        data-testid="bpx-run-verify"
        @click="verifyAgain"
      />
    </div>
    <p v-if="isActive && pixel.event?.lastCheckedAt" class="text-xs text-muted">
      ตรวจล่าสุด {{ bcPixelDateTime(pixel.event.lastCheckedAt) }} · {{ bcPixelStatusRawText(pixel.event.lastStatusRaw) }}
    </p>

    <template v-if="showStart">
      <p class="text-muted" data-testid="bpx-run-note">
        {{ bcPixelRunNote(BC_PIXEL_PRESSES_DEFAULT) }}
      </p>
      <p
        v-if="startBlockedText"
        class="rounded-md bg-error/10 px-2 py-1.5 text-xs text-error"
      >
        {{ startBlockedText }}
      </p>
      <UButton
        :label="BC_PIXEL_TEXT.runStart"
        icon="i-lucide-mouse-pointer-click"
        color="primary"
        size="sm"
        :loading="busy === 'start'"
        :disabled="startDisabled"
        data-testid="bpx-run-start"
        @click="start"
      />
    </template>

    <BcPixelsRunCard
      v-if="run"
      :run="run"
      :busy="cardBusy"
      :locked="pixel.superseded"
      @stop="runAction('stop')"
      @resume="runAction('resume')"
      @retry="runAction('retry')"
    />

    <p
      v-if="refusal"
      class="rounded-md bg-error/10 px-2 py-1.5 text-xs break-words text-error"
      role="alert"
      data-testid="bpx-run-error"
    >
      {{ refusal }}
    </p>
  </div>
</template>
