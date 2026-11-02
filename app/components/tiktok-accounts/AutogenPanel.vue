<script setup lang="ts">
/**
 * FEAT-097 (spec "UI behaviour → Panel", AC-18/AC-19; api-contract.md v1 §5/§6) — the progress slideover of one
 * auto-gen run. Pure presentation like `OrganizationRows`: the page owns `useApi()`, the 2 s `latest` poll and
 * every action request; this component only renders the run it is handed and emits the four actions
 * (stop / resume / retry / retry-row) plus `reload` for its own error-state retry. Updates ride on the poll.
 */
import type {
  BcAutogenRunView,
  BcAutogenStep,
  BcAutogenStepKind
} from '#shared/types/bc-autogen'

const props = defineProps<{
  accountLabel: string | null
  /** the run as the page's poll last read it; `null` while the first `latest` has not answered */
  run: BcAutogenRunView | null
  /** true until the first `latest` answer (spinner state) */
  loading: boolean
  /** error text when `latest` failed (the panel offers Retry) */
  loadError: string | null
  /** true while a stop/resume/retry POST is in flight (buttons disabled, optimistic) */
  actionBusy: boolean
}>()

const emit = defineEmits<{
  'stop': []
  'resume': []
  'retry': []
  'retry-row': [rowIdx: number]
  /** the `ta-autogen-panel-retry` of the error state — the page re-reads `latest` */
  'reload': []
}>()

const open = defineModel<boolean>('open', { default: false })
const slideoverContent = { 'data-testid': 'ta-autogen-panel' } as Record<string, unknown>

const now = useNow({ interval: 1000 })

const STATUS_TEXT: Record<string, string> = {
  running: 'กำลังทำ',
  stopping: 'กำลังหยุด',
  stopped: 'หยุดแล้ว',
  completed: 'เสร็จแล้ว'
}
const STATUS_COLOR: Record<string, 'primary' | 'warning' | 'success'> = {
  running: 'primary',
  stopping: 'warning',
  stopped: 'warning',
  completed: 'success'
}

function fmtTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
}

/** m:ss since `startedAt`, ticking from the `now` clock (the "● กำลังทำ · m:ss" of an active item) */
function elapsed(startedAt: string | null): string {
  if (!startedAt) return '0:00'
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return '0:00'
  const secs = Math.max(0, Math.floor((now.value.getTime() - start) / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const counts = computed(() => props.run?.counts ?? { total: 0, pending: 0, active: 0, done: 0, failed: 0, skipped: 0 })
const doneSoFar = computed(() => counts.value.done + counts.value.failed + counts.value.skipped)
const rowsTotal = computed(() => props.run?.rows.length ?? 0)
const advTotal = computed(() =>
  (props.run?.rows ?? []).reduce((sum, r) => sum + (r.adv ? r.adv.count : 0), 0)
)
const metaText = computed(() => {
  const r = props.run
  if (!r) return ''
  return `เริ่ม ${fmtTime(r.createdAt)} · ${rowsTotal.value} Sub BC · ${advTotal.value} บัญชีโฆษณา`
    + ` · ทำไปแล้ว ${doneSoFar.value} / ${counts.value.total} งาน`
})

/** progress segments as percentages of `total` (done green · failed red · active amber · rest grey) */
function pct(n: number): string {
  const total = counts.value.total || 1
  return `${(n / total) * 100}%`
}
const canRetry = computed(() => (counts.value.failed + counts.value.skipped) > 0)
const isTerminalish = computed(() => props.run?.status === 'stopped' || props.run?.status === 'completed')

/** the sub / discover / (discoverOrg) steps of a row, with the testid suffix and label the panel renders */
function panelSteps(row: BcAutogenRunView['rows'][number]): { key: BcAutogenStepKind, label: string, step: BcAutogenStep }[] {
  const out: { key: BcAutogenStepKind, label: string, step: BcAutogenStep }[] = [
    { key: 'sub', label: 'Sub BC', step: row.sub },
    { key: 'discover', label: 'Sync', step: row.discover }
  ]
  if (row.discoverOrg) out.push({ key: 'discoverOrg', label: 'Sync org', step: row.discoverOrg })
  return out
}

/** the red footer of a row whose advertisers were skipped by a quota / suspension refusal */
function limitNote(row: BcAutogenRunView['rows'][number]): string | null {
  const items = row.adv?.items ?? []
  const hit = items.some(i =>
    (i.status === 'skipped' && (i.reason === 'limitReached' || i.reason === 'suspendedAdvertiser'))
    || (i.status === 'failed' && (i.error === 'limitReached' || i.error === 'suspendedAdvertiser'))
  )
  if (!hit) return null
  const failed = items.find(i => i.status === 'failed' && i.lastLog)
  return failed?.lastLog ?? items.find(i => i.lastLog)?.lastLog ?? 'TikTok ปฏิเสธการสร้างบัญชีโฆษณา'
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :content="slideoverContent"
    :ui="{ content: 'max-w-xl' }"
  >
    <template #header>
      <div class="flex w-full items-center gap-2">
        <h2 class="flex-1 truncate text-sm font-semibold text-highlighted">
          งานสร้างอัตโนมัติ · {{ accountLabel || '—' }}
        </h2>
        <UBadge
          v-if="run"
          :color="STATUS_COLOR[run.status]"
          variant="subtle"
          size="sm"
          data-testid="ta-autogen-status"
          :data-status="run.status"
        >
          {{ STATUS_TEXT[run.status] }}
        </UBadge>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="ปิด"
          data-testid="ta-autogen-close"
          @click="open = false"
        />
      </div>
    </template>

    <template #body>
      <!-- loading (before the first latest answer) -->
      <div v-if="loading && !run" class="flex flex-col gap-3" data-testid="ta-autogen-panel-loading">
        <USkeleton v-for="i in 4" :key="i" class="h-16 w-full" />
      </div>

      <!-- error -->
      <div
        v-else-if="loadError && !run"
        class="flex flex-col items-center gap-3 py-10 text-center"
        data-testid="ta-autogen-panel-error"
      >
        <UIcon name="i-lucide-triangle-alert" class="size-8 text-error" />
        <p class="text-sm text-muted">
          {{ loadError }}
        </p>
        <UButton
          label="ลองใหม่"
          color="neutral"
          variant="outline"
          size="sm"
          data-testid="ta-autogen-panel-retry"
          @click="emit('reload')"
        />
      </div>

      <div v-else-if="run" class="flex flex-col gap-4">
        <!-- meta + progress -->
        <div class="space-y-2">
          <p class="text-xs text-muted" data-testid="ta-autogen-meta">
            {{ metaText }}
          </p>
          <div
            class="flex h-2 w-full overflow-hidden rounded-full bg-elevated"
            data-testid="ta-autogen-progress"
            :data-done="counts.done"
            :data-failed="counts.failed"
            :data-active="counts.active"
            :data-total="counts.total"
          >
            <div class="bg-success" :style="{ width: pct(counts.done) }" />
            <div class="bg-error" :style="{ width: pct(counts.failed) }" />
            <div class="bg-warning" :style="{ width: pct(counts.active) }" />
          </div>
          <div class="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-dimmed">
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-success" /> เสร็จ {{ counts.done }}</span>
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-error" /> ล้ม {{ counts.failed }}</span>
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-warning" /> กำลังทำ {{ counts.active }}</span>
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-elevated ring-1 ring-default" /> ข้าม {{ counts.skipped }}</span>
          </div>
        </div>

        <!-- per-row cards -->
        <div class="space-y-3">
          <div
            v-for="row in run.rows"
            :key="row.idx"
            class="rounded-lg border border-default p-3"
            :data-testid="`ta-autogen-prow-${row.idx}`"
            :data-status="row.status"
            :data-org-id="row.orgId ?? ''"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="flex items-center gap-1 text-sm font-medium text-highlighted">
                  <UIcon v-if="row.status === 'done'" name="i-lucide-check" class="size-4 shrink-0 text-success" />
                  <UIcon v-else-if="row.status === 'failed'" name="i-lucide-x" class="size-4 shrink-0 text-error" />
                  <UIcon v-else-if="row.status === 'active'" name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-primary" />
                  <UIcon v-else-if="row.status === 'skipped'" name="i-lucide-minus" class="size-4 shrink-0 text-dimmed" />
                  <span v-else class="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-elevated text-[10px] text-dimmed">{{ row.idx + 1 }}</span>
                  <span class="truncate">{{ row.name }}</span>
                </p>
                <p v-if="row.orgId" class="mt-0.5 font-mono text-xs text-muted">
                  …{{ row.orgId.slice(-4) }} · {{ row.currency }}
                </p>
              </div>
              <div class="flex shrink-0 flex-col items-end gap-0.5 text-xs">
                <span
                  v-for="s in panelSteps(row)"
                  :key="s.key"
                  class="flex items-center gap-1 whitespace-nowrap"
                  :data-testid="`ta-autogen-pstep-${row.idx}-${s.key}`"
                  :data-status="s.step.status"
                >
                  <span class="text-dimmed">{{ s.label }}</span>
                  <template v-if="s.step.status === 'done'">
                    <UIcon name="i-lucide-check" class="size-3.5 text-success" />
                    <span class="text-muted">{{ fmtTime(s.step.finishedAt) }}</span>
                  </template>
                  <template v-else-if="s.step.status === 'failed'">
                    <UIcon name="i-lucide-triangle-alert" class="size-3.5 text-warning" />
                    <span class="max-w-32 truncate text-muted" :title="s.step.error ?? ''">{{ s.step.error }}</span>
                  </template>
                  <UIcon v-else-if="s.step.status === 'active'" name="i-lucide-loader-circle" class="size-3.5 animate-spin text-primary" />
                  <UIcon v-else-if="s.step.status === 'skipped'" name="i-lucide-minus" class="size-3.5 text-dimmed" />
                  <span v-else class="text-dimmed">รอ</span>
                </span>
              </div>
            </div>

            <!-- advertiser grid -->
            <div v-if="row.adv" class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="item in row.adv.items"
                :key="item.seq"
                class="inline-flex items-center gap-1 rounded border border-default px-1.5 py-0.5 text-[11px]"
                :data-testid="`ta-autogen-pitem-${row.idx}-${item.seq}`"
                :data-status="item.status"
                :data-reason="item.reason ?? ''"
                :title="item.name"
              >
                <template v-if="item.status === 'done'">
                  <UIcon name="i-lucide-check" class="size-3 text-success" />
                  <span class="text-muted">{{ fmtTime(item.finishedAt) }}</span>
                </template>
                <template v-else-if="item.status === 'failed'">
                  <UIcon name="i-lucide-x" class="size-3 text-error" />
                  <span class="max-w-28 truncate text-muted" :title="item.error ?? ''">{{ item.error }}</span>
                </template>
                <template v-else-if="item.status === 'active'">
                  <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin text-primary" />
                  <span class="text-muted">กำลังทำ · {{ elapsed(item.startedAt) }}</span>
                </template>
                <template v-else-if="item.status === 'skipped'">
                  <UIcon name="i-lucide-minus" class="size-3 text-dimmed" />
                  <span class="text-dimmed">{{ bcAutogenSkipText(item.reason) }}</span>
                </template>
                <template v-else>
                  <UIcon name="i-lucide-circle" class="size-3 text-dimmed" />
                  <span class="text-dimmed">รอ</span>
                </template>
                <span class="font-mono text-dimmed">{{ item.name }}</span>
              </span>
            </div>

            <!-- quota / suspension footer -->
            <div
              v-if="limitNote(row)"
              class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded bg-error/10 px-2 py-1 text-[11px] text-error"
              :data-testid="`ta-autogen-prow-note-${row.idx}`"
            >
              <span class="min-w-0 flex-1 truncate" :title="limitNote(row) ?? ''">{{ limitNote(row) }}</span>
              <UButton
                label="ลองใหม่ภายหลัง"
                color="error"
                variant="soft"
                size="xs"
                :disabled="!isTerminalish || actionBusy"
                :data-testid="`ta-autogen-retry-row-${row.idx}`"
                @click="emit('retry-row', row.idx)"
              />
            </div>

            <!-- current-step footer -->
            <p
              v-if="run.current && run.current.rowIdx === row.idx"
              class="mt-2 text-[11px] text-dimmed"
            >
              job <span class="font-mono" data-testid="ta-autogen-job-link">…{{ run.current.jobId.slice(-4) }}</span>
              · {{ stepText(run) }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <div v-if="run" class="flex w-full flex-col gap-2">
        <div class="flex flex-wrap items-center justify-end gap-2">
          <UButton
            v-if="run.status === 'running' || run.status === 'stopping'"
            :label="run.status === 'stopping' ? 'กำลังหยุด…' : 'หยุดหลังงานปัจจุบัน'"
            icon="i-lucide-square"
            color="warning"
            variant="outline"
            size="sm"
            :disabled="run.status === 'stopping' || actionBusy"
            data-testid="ta-autogen-stop"
            @click="emit('stop')"
          />
          <UButton
            v-if="run.status === 'stopped'"
            label="ทำต่อ"
            icon="i-lucide-play"
            color="primary"
            variant="solid"
            size="sm"
            :disabled="actionBusy"
            data-testid="ta-autogen-resume"
            @click="emit('resume')"
          />
          <UButton
            v-if="run.status === 'stopped' || run.status === 'completed'"
            label="ลองใหม่เฉพาะที่ล้ม/ข้าม"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="!canRetry || actionBusy"
            data-testid="ta-autogen-retry"
            @click="emit('retry')"
          />
        </div>
        <p class="text-right text-[11px] text-dimmed">
          ปิดแผงนี้ได้ งานยังทำต่อ · อัปเดตทุก 2 วิ
        </p>
      </div>
    </template>
  </USlideover>
</template>
