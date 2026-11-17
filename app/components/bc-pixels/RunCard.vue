<script setup lang="ts">
/**
 * FEAT-102 — the activation run card (`bpx-run[data-status][data-outcome]`; spec "UI behaviour → Panel" 5, AC-26;
 * api-contract §2.4, §5.1, §7.3, §7.4 run ids). Pure renderer of one `RunView`: status badge (outcome once
 * `completed`, + the stop reason when `stopped`), the activate sub-step (`bpx-run-activate`: sent k/presses, attempt n,
 * error text + last log) and the verify sub-step (`bpx-run-verify-step`: checks, `bpx-run-countdown` mm:ss to
 * `nextCheckAt` while waiting, `bpx-run-deadline` HH:mm, last status, error text + last log). Buttons by status:
 * `running` → stop · `stopping` → stop disabled · `stopped` → resume + retry · `completed` with `notActive` /
 * `failed` → retry. The step owns the requests; the card only emits.
 */
import type { RunView } from '#shared/types/bc-pixels'

const props = defineProps<{
  run: RunView
  /** a stop / resume / retry POST is in flight */
  busy: 'stop' | 'resume' | 'retry' | null
  /** resume / retry are not offered (superseded pixel) */
  locked: boolean
}>()

const emit = defineEmits<{
  stop: []
  resume: []
  retry: []
}>()

const now = useNow({ interval: 1000 })

const actions = computed(() => bcPixelRunActions(props.run))
const statusText = computed(() => bcPixelRunStatusText(props.run))
const color = computed(() => bcPixelRunColor(props.run))

const activate = computed(() => props.run.activate)
const verify = computed(() => props.run.verify)

const countdown = computed(() =>
  verify.value.status === 'waiting' && verify.value.nextCheckAt ? bcPixelCountdown(verify.value.nextCheckAt, now.value) : ''
)
const deadline = computed(() => bcPixelTime(verify.value.deadlineAt))

/** activate went back to `pending` after `ruleNotEffective` — the engine presses again later */
const activateRetrying = computed(() => activate.value.status === 'pending' && activate.value.attempts > 0 && props.run.status === 'running')

const STEP_ICON: Record<string, { name: string, class: string }> = {
  pending: { name: 'i-lucide-circle-dashed', class: 'text-dimmed' },
  active: { name: 'i-lucide-loader-circle', class: 'animate-spin text-primary' },
  waiting: { name: 'i-lucide-hourglass', class: 'text-primary' },
  done: { name: 'i-lucide-circle-check', class: 'text-success' },
  failed: { name: 'i-lucide-circle-x', class: 'text-error' },
  skipped: { name: 'i-lucide-circle-minus', class: 'text-dimmed' }
}
function icon(status: string): { name: string, class: string } {
  return STEP_ICON[status] ?? STEP_ICON.pending!
}
</script>

<template>
  <div
    class="space-y-2.5 rounded-md border border-default bg-elevated/30 p-2.5 text-xs sm:p-3"
    data-testid="bpx-run"
    :data-status="run.status"
    :data-outcome="run.outcome ?? ''"
  >
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
      <UBadge
        :color="color"
        variant="subtle"
        size="sm"
        class="whitespace-nowrap"
      >
        <UIcon
          v-if="run.status === 'running' || run.status === 'stopping'"
          name="i-lucide-loader-circle"
          class="size-3 animate-spin"
        />
        {{ statusText }}
      </UBadge>
      <span v-if="run.status === 'stopped' && run.stopReason" class="font-medium text-warning">
        {{ bcPixelRunStopText(run.stopReason) }}
      </span>
      <UBadge
        v-if="run.mode === 'verifyOnly'"
        color="neutral"
        variant="outline"
        size="sm"
        class="whitespace-nowrap"
      >
        ตรวจสถานะอย่างเดียว
      </UBadge>
      <span class="text-muted">
        เริ่ม {{ bcPixelDateTime(run.createdAt) }}<template v-if="run.finishedAt">
          · จบ {{ bcPixelDateTime(run.finishedAt) }}
        </template>
      </span>
    </div>

    <!-- activate -->
    <div class="flex items-start gap-2" data-testid="bpx-run-activate" :data-status="activate.status">
      <UIcon :name="icon(activate.status).name" class="mt-0.5 size-4 shrink-0" :class="icon(activate.status).class" />
      <div class="min-w-0 flex-1 space-y-0.5">
        <p class="flex flex-wrap items-center gap-x-2">
          <span class="font-medium text-highlighted">กดปุ่ม</span>
          <span class="text-muted">{{ BC_PIXEL_RUN_STEP_TEXT[activate.status] }}</span>
        </p>
        <p v-if="activate.status === 'skipped' && run.mode === 'verifyOnly'" class="text-muted">
          ไม่กดปุ่ม — อ่านสถานะ event อย่างเดียว
        </p>
        <p v-else class="text-default">
          ส่ง event แล้ว {{ activate.sent }}/{{ run.presses }}
          <template v-if="activate.attempts > 0">
            · รอบที่ {{ activate.attempts }}
          </template>
        </p>
        <p
          v-if="activate.error"
          class="break-words"
          :class="activateRetrying ? 'text-warning' : 'text-error'"
        >
          {{ bcPixelErrorText(activate.error) }}<template v-if="activateRetrying">
            — จะกดใหม่อีกครั้งอัตโนมัติ
          </template>
        </p>
        <p v-if="activate.lastLog" class="break-words text-muted">
          {{ activate.lastLog }}
        </p>
      </div>
    </div>

    <!-- verify -->
    <div class="flex items-start gap-2" data-testid="bpx-run-verify-step" :data-status="verify.status">
      <UIcon :name="icon(verify.status).name" class="mt-0.5 size-4 shrink-0" :class="icon(verify.status).class" />
      <div class="min-w-0 flex-1 space-y-0.5">
        <p class="flex flex-wrap items-center gap-x-2">
          <span class="font-medium text-highlighted">รอเขียว</span>
          <span class="text-muted">{{ BC_PIXEL_RUN_STEP_TEXT[verify.status] }}</span>
        </p>
        <p class="flex flex-wrap gap-x-2 text-default">
          <span>ตรวจแล้ว {{ verify.checks }} ครั้ง</span>
          <span v-if="verify.checks > 0 || verify.lastStatusRaw !== null" class="text-muted">
            · สถานะล่าสุด {{ bcPixelStatusRawText(verify.lastStatusRaw) }}
          </span>
        </p>
        <p v-if="countdown || deadline" class="flex flex-wrap gap-x-3 text-default">
          <span v-if="countdown">
            ครั้งถัดไป <span class="font-mono tabular-nums" data-testid="bpx-run-countdown">{{ countdown }}</span>
          </span>
          <span v-if="deadline">
            หมดเวลา <span class="font-mono tabular-nums" data-testid="bpx-run-deadline">{{ deadline }}</span>
          </span>
        </p>
        <p v-if="verify.error" class="break-words text-error">
          {{ bcPixelErrorText(verify.error) }}
        </p>
        <p v-if="verify.lastLog" class="break-words text-muted">
          {{ verify.lastLog }}
        </p>
      </div>
    </div>

    <div
      v-if="actions.stop || actions.resume || actions.retry"
      class="flex flex-wrap justify-end gap-2 pt-0.5"
    >
      <UButton
        v-if="actions.stop"
        :label="run.status === 'stopping' ? 'กำลังหยุด…' : 'หยุด'"
        icon="i-lucide-square"
        color="neutral"
        variant="outline"
        size="xs"
        :loading="busy === 'stop'"
        :disabled="actions.stopDisabled || !!busy"
        data-testid="bpx-run-stop"
        @click="emit('stop')"
      />
      <UButton
        v-if="actions.resume"
        label="ทำต่อ"
        icon="i-lucide-play"
        color="primary"
        size="xs"
        :loading="busy === 'resume'"
        :disabled="locked || !!busy"
        data-testid="bpx-run-resume"
        @click="emit('resume')"
      />
      <UButton
        v-if="actions.retry"
        label="ลองใหม่"
        icon="i-lucide-rotate-ccw"
        color="primary"
        :variant="actions.resume ? 'outline' : 'solid'"
        size="xs"
        :loading="busy === 'retry'"
        :disabled="locked || !!busy"
        data-testid="bpx-run-retry"
        @click="emit('retry')"
      />
    </div>
  </div>
</template>
