<script setup lang="ts">
/**
 * FEAT-102 — step 4 "ผูกบัญชีโฆษณา" (spec "UI behaviour → Panel" 4, AC-25; api-contract §3.9, §3.10, §7.4 link ids).
 * Needs step 1 only. Summary `bpx-link-summary[data-linked][data-total]` + `bpx-link-open` → the inline picker
 * (`AccountsPicker`, `bpx-accounts`). Link: `bpx-link-submit` → exactly one `POST …/link { advertiserIds }` (`retry: 0`).
 * Unlink: `bpx-unlink-<id>` → confirm dialog → `bpx-unlink-confirm` → exactly one `POST …/unlink` with that id.
 * A 202 closes the picker, toasts (with the `skipped` ids, if any) and hands `{ pixel }` to the panel, which polls
 * while the job runs. While a link / unlink job is open the picker is closed, `bpx-link-open` is disabled and
 * `bpx-link-busy` ("กำลังทำงานผูกบัญชีอยู่") shows. A 409 shows the API's `error` (inside the picker when open); `advertiserSuspended` (v1.13) also drops `advertiserIds` from the selection and reloads the picker only, and from the
 * request the job card's ลองใหม่ would re-send (none left → no retry); with the picker closed the refusal adds what was taken out.
 * The job card's ลองใหม่ repeats the last request (same kind, same ids); after a page reload that request is not
 * known (`PixelJobView` has no payload, contract v1.2) → the button stays disabled with a hint to pick again.
 * A superseded pixel keeps only unlink (the picker opens; ticking and linking are disabled).
 */
import type { PixelAccountRow, PixelLinkAccepted, PixelView } from '#shared/types/bc-pixels'

const props = defineProps<{
  pixel: PixelView
}>()

const emit = defineEmits<{
  updated: [view: PixelView]
  reload: []
}>()

const api = useApi()
const toast = useToast()

type LinkKind = 'link' | 'unlink'
interface LinkRequest { kind: LinkKind, ids: string[] }

const pickerOpen = ref(false)
const posting = ref(false)
const refusal = ref<string | null>(null)
const lastRequest = ref<LinkRequest | null>(null)
const picker = ref<{ reload: () => void, dropSuspended: (ids: string[]) => void } | null>(null)

watch(() => props.pixel.id, () => {
  pickerOpen.value = false
  refusal.value = null
  lastRequest.value = null
})

const job = computed(() => props.pixel.jobs.link)
const jobOpen = computed(() => isPixelJobOpen(job.value))
const jobKind = computed<LinkKind | null>(() => {
  const t = job.value?.type
  if (t === 'bcPixelLink') return 'link'
  if (t === 'bcPixelUnlink') return 'unlink'
  return null
})
const showJob = computed(() => {
  const j = job.value
  return !!j && (isPixelJobOpen(j) || isPixelJobFailed(j))
})

// a job that opens (from this tab or another) closes the picker
watch(jobOpen, (open) => {
  if (open) pickerOpen.value = false
})

function openPicker() {
  refusal.value = null
  pickerOpen.value = true
}

async function send(req: LinkRequest) {
  if (posting.value || !req.ids.length) return
  posting.value = true
  refusal.value = null
  lastRequest.value = req
  try {
    const res = await api<PixelLinkAccepted>(`/bc-pixels/${encodeURIComponent(props.pixel.id)}/${req.kind}`, {
      method: 'POST',
      retry: 0,
      body: { advertiserIds: req.ids }
    })
    const skipped = bcPixelSkippedText(res.skipped ?? [])
    const queued = res.queued?.length ?? req.ids.length
    toast.add({
      title: req.kind === 'link' ? BC_PIXEL_TOAST.linkStarted : BC_PIXEL_TOAST.unlinkStarted,
      description: [`${queued} บัญชี`, skipped].filter(Boolean).join(' · '),
      color: 'info'
    })
    pickerOpen.value = false
    emit('updated', res.pixel)
  } catch (e) {
    const f = bcPixelFailure(e, req.kind === 'link' ? 'ผูกบัญชีไม่สำเร็จ' : 'เลิกผูกบัญชีไม่สำเร็จ')
    let message = f.message
    if (f.status === 409 && f.reason === 'advertiserSuspended') {
      const suspended = f.body?.advertiserIds ?? []
      // retry from the job card: the picker is closed, so the refusal must say what happened to the request
      const fromPicker = !!picker.value
      const left = dropFromLastRequest(req.kind, suspended)
      picker.value?.dropSuspended(suspended)
      if (!fromPicker) message = bcPixelSuspendedDroppedText(f.message, suspended, left)
    }
    refusal.value = message
    toast.add({ title: req.kind === 'link' ? 'ผูกบัญชีไม่ได้' : 'เลิกผูกบัญชีไม่ได้', description: message, color: 'error' })
    if (f.status === 409) {
      // the list or the view is stale: re-read what the API says now
      if (['alreadyLinked', 'notLinked', 'unknownAdvertiser'].includes(f.reason ?? '')) picker.value?.reload()
      // every id is already linked / none is linked: the request has nothing left to do, so the job card must not offer it again
      if (f.reason === 'alreadyLinked' || f.reason === 'notLinked') lastRequest.value = null
      // the pixel view is still right when the refusal is about the picked advertisers only
      if (f.reason !== 'unknownAdvertiser' && f.reason !== 'advertiserSuspended') emit('reload')
    }
  } finally {
    posting.value = false
  }
}

/**
 * 409 `advertiserSuspended`: take the refused ids out of the request the job card's retry would re-send (same kind only).
 * Returns the ids left; none left (or the API named no id, so the request cannot be fixed) → `lastRequest` is cleared.
 */
function dropFromLastRequest(kind: LinkKind, suspended: string[]): string[] {
  const r = lastRequest.value
  if (!r || r.kind !== kind) return []
  const left = suspended.length ? r.ids.filter(id => !suspended.includes(id)) : []
  lastRequest.value = left.length ? { kind, ids: left } : null
  return left
}

function link(ids: string[]) {
  void send({ kind: 'link', ids })
}

// ── unlink confirm ───────────────────────────────────────────────────────────────────────────────────────────────────
const confirmRow = ref<PixelAccountRow | null>(null)
const confirmOpen = computed({
  get: () => !!confirmRow.value,
  set: (v: boolean) => {
    if (!v) confirmRow.value = null
  }
})
const confirmContent = { 'data-testid': 'bpx-unlink-dialog' } as Record<string, unknown>

function askUnlink(row: PixelAccountRow) {
  if (posting.value || jobOpen.value) return
  confirmRow.value = row
}
function confirmUnlink() {
  const row = confirmRow.value
  confirmRow.value = null
  if (row) void send({ kind: 'unlink', ids: [row.advertiserId] })
}

// ── retry of the job card ────────────────────────────────────────────────────────────────────────────────────────────
const retryRequest = computed<LinkRequest | null>(() => {
  const r = lastRequest.value
  return r && r.kind === jobKind.value ? r : null
})
const retryable = computed(() => jobKind.value === 'unlink' || !props.pixel.superseded)
function retry() {
  if (retryRequest.value) void send(retryRequest.value)
}

const openDisabled = computed(() => jobOpen.value || posting.value)
</script>

<template>
  <div class="space-y-3">
    <p
      class="text-highlighted"
      data-testid="bpx-link-summary"
      :data-linked="pixel.linkedCount"
      :data-total="pixel.advertiserCount"
    >
      {{ bcPixelLinkSummary(pixel.linkedCount, pixel.advertiserCount) }}
    </p>
    <p v-if="pixel.linkedSyncedAt" class="text-xs text-muted">
      อ่านจาก BC ล่าสุด {{ bcPixelDateTime(pixel.linkedSyncedAt) }}
    </p>

    <p
      v-if="jobOpen"
      class="flex items-center gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-xs text-primary"
      data-testid="bpx-link-busy"
    >
      <UIcon name="i-lucide-loader-circle" class="size-3.5 shrink-0 animate-spin" />
      <span>{{ BC_PIXEL_TEXT.linkBusy }}</span>
    </p>

    <UButton
      v-if="!pickerOpen || jobOpen"
      :label="pixel.superseded ? 'ดูบัญชีที่ผูก / เลิกผูก' : 'เลือกบัญชีที่จะผูก'"
      icon="i-lucide-link"
      color="primary"
      :variant="pixel.steps.link === 'done' ? 'outline' : 'solid'"
      size="sm"
      :disabled="openDisabled"
      data-testid="bpx-link-open"
      @click="openPicker"
    />

    <p
      v-if="refusal && (!pickerOpen || jobOpen)"
      class="rounded-md bg-error/10 px-2 py-1.5 text-xs break-words text-error"
      role="alert"
      data-testid="bpx-link-error"
    >
      {{ refusal }}
    </p>

    <BcPixelsAccountsPicker
      v-if="pickerOpen && !jobOpen"
      ref="picker"
      :pixel-id="pixel.id"
      :superseded="pixel.superseded"
      :posting="posting"
      :error="refusal"
      @link="link"
      @unlink="askUnlink"
      @close="pickerOpen = false"
    />

    <BcPixelsJobCard
      v-if="job && showJob"
      kind="link"
      :job="job"
      :retryable="retryable"
      :retrying="posting"
      :retry-blocked-hint="retryRequest ? null : 'เปิดรายการบัญชีแล้วเลือกใหม่'"
      @retry="retry"
    />

    <UModal
      v-model:open="confirmOpen"
      title="เลิกผูกบัญชีโฆษณา"
      :content="confirmContent"
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <p v-if="confirmRow" class="text-sm break-words">
          เลิกผูก <span class="font-medium text-highlighted">{{ confirmRow.name || confirmRow.advertiserId }}</span>
          <span class="font-mono text-muted">(…{{ bcPixelTail(confirmRow.advertiserId) }})</span>
          จาก pixel “{{ pixel.name }}” ใน Business Center?
        </p>
        <p class="mt-2 text-xs text-muted">
          ระบบจะเปิด BC ด้วยโปรไฟล์ของบัญชีนี้แล้วกด Remove ให้ บัญชีนั้นจะไม่เห็น pixel นี้อีก
        </p>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="outline"
            @click="confirmOpen = false"
          />
          <UButton
            label="เลิกผูก"
            color="error"
            icon="i-lucide-unlink"
            data-testid="bpx-unlink-confirm"
            @click="confirmUnlink"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
