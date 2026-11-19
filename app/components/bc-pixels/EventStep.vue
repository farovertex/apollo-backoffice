<script setup lang="ts">
/**
 * FEAT-102 — step 3 "สร้าง event กดปุ่ม" (spec "UI behaviour → Panel" 3, AC-24; api-contract §3.7, §3.8).
 * Needs step 2. While the pixel has no event, the site's buttons are read once with `GET /bc-pixels/:id/buttons`
 * (again on `bpx-buttons-reload` or after a `buttonNotFound` 409) and listed as `bpx-button-<n>` (page name ·
 * button text; a text that occurs twice on its page is marked). Picking one enables `bpx-event-create` → exactly
 * one `POST …/event` with `{ pageId, blockId, itemIndex }` (`retry: 0`) → 202 `{ pixel }` to the panel. The job
 * card repeats the last body on ลองใหม่ (after a reload the body is unknown — `PixelJobView` carries no payload —
 * so ลองใหม่ stays disabled with a hint until a button is picked). Done: `bpx-event-info` "Click button · ปุ่ม “<text>” · rule …last4", plus
 * `bpx-event-stale` when the stored text is no longer a button of that page (`targetOnSite: false`).
 */
import type {
  PixelButton,
  PixelButtonsResponse,
  PixelEventBody,
  PixelView,
  PixelViewResponse
} from '#shared/types/bc-pixels'

const props = defineProps<{
  pixel: PixelView
}>()

const emit = defineEmits<{
  updated: [view: PixelView]
  reload: []
}>()

const api = useApi()
const toast = useToast()

// ── buttons ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const buttons = ref<PixelButton[]>([])
const buttonsLoaded = ref(false)
const buttonsPending = ref(false)
const buttonsError = ref<string | null>(null)
const picked = ref<number | null>(null)
let seq = 0

// event POST state (declared first: the immediate watcher below resets it on a pixel switch)
const posting = ref(false)
const conflict = ref<string | null>(null)
/** the body of the last POST — what the job card's ลองใหม่ repeats */
const lastBody = ref<PixelEventBody | null>(null)

async function loadButtons() {
  const s = ++seq
  buttonsPending.value = true
  buttonsError.value = null
  try {
    const res = await api<PixelButtonsResponse>(`/bc-pixels/${encodeURIComponent(props.pixel.id)}/buttons`, { retry: 0 })
    if (s !== seq) return
    buttons.value = res.buttons ?? []
    buttonsLoaded.value = true
    // keep the pick only when it still names the same button
    if (picked.value !== null && !buttons.value[picked.value]) picked.value = null
  } catch (e) {
    if (s !== seq) return
    buttonsError.value = bcPixelFailure(e, 'โหลดรายการปุ่มไม่สำเร็จ').message
  } finally {
    if (s === seq) buttonsPending.value = false
  }
}

const job = computed(() => props.pixel.jobs.event)
const jobOpen = computed(() => isPixelJobOpen(job.value))
const showJob = computed(() => {
  const j = job.value
  if (!j) return false
  return isPixelJobOpen(j) || isPixelJobFailed(j) || !props.pixel.event
})

/** the list is needed only while there is no event yet and the code is on the site */
const needButtons = computed(() => props.pixel.installed && !props.pixel.event && !props.pixel.superseded)

watch(() => [props.pixel.id, needButtons.value] as const, ([id, need], old) => {
  if (old && old[0] !== id) {
    seq++
    buttons.value = []
    buttonsLoaded.value = false
    picked.value = null
    lastBody.value = null
    conflict.value = null
  }
  if (need && !buttonsLoaded.value && !buttonsPending.value) void loadButtons()
}, { immediate: true })

// ── event POST ───────────────────────────────────────────────────────────────────────────────────────────────────────

const pickedButton = computed(() => (picked.value !== null ? buttons.value[picked.value] ?? null : null))

async function send(body: PixelEventBody) {
  if (posting.value) return
  posting.value = true
  conflict.value = null
  lastBody.value = body
  try {
    const res = await api<PixelViewResponse>(`/bc-pixels/${encodeURIComponent(props.pixel.id)}/event`, { method: 'POST', retry: 0, body })
    toast.add({ title: BC_PIXEL_TOAST.eventStarted, color: 'info' })
    emit('updated', res.pixel)
  } catch (e) {
    const f = bcPixelFailure(e, 'สร้าง event ไม่สำเร็จ')
    conflict.value = f.message
    toast.add({ title: 'สร้าง event ไม่ได้', description: f.message, color: 'error' })
    if (f.reason === 'buttonNotFound') {
      picked.value = null
      void loadButtons()
    } else if (f.status === 409 && f.reason !== 'duplicate') {
      emit('reload')
    }
  } finally {
    posting.value = false
  }
}

function createEvent() {
  const b = pickedButton.value
  if (!b) return
  void send({ pageId: b.pageId, blockId: b.blockId, itemIndex: b.itemIndex })
}

/** ลองใหม่ = the same request again; without a remembered body (page reloaded) it falls back to the current pick */
const retryBody = computed<PixelEventBody | null>(() => {
  if (lastBody.value) return lastBody.value
  const b = pickedButton.value
  return b ? { pageId: b.pageId, blockId: b.blockId, itemIndex: b.itemIndex } : null
})
function retry() {
  if (retryBody.value) void send(retryBody.value)
}

const createDisabled = computed(() =>
  props.pixel.superseded || !pickedButton.value || jobOpen.value || posting.value || props.pixel.siteGone
)
</script>

<template>
  <div class="space-y-3">
    <!-- done -->
    <div v-if="pixel.event" class="space-y-2" data-testid="bpx-event-info">
      <p class="break-words text-highlighted">
        Click button · ปุ่ม “{{ pixel.event.buttonText }}” · rule …{{ pixel.event.ruleIdLast4 }}
      </p>
      <p class="truncate text-xs text-muted" :title="pixel.event.pageUrl">
        {{ pixel.event.pageUrl }} · สร้างเมื่อ {{ bcPixelDateTime(pixel.event.createdAt) }}
      </p>
      <p
        v-if="!pixel.event.targetOnSite"
        class="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning"
        data-testid="bpx-event-stale"
      >
        <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
        <span>{{ BC_PIXEL_TEXT.eventStale }}</span>
      </p>
    </div>

    <p v-else-if="!pixel.installed" class="text-muted">
      ใส่โค้ด pixel ลงเว็บก่อน (ขั้นที่ 2)
    </p>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-muted">
          เลือกปุ่มบนเว็บที่จะนับเป็น event “Click button”
        </p>
        <UButton
          label="โหลดปุ่มใหม่"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          :loading="buttonsPending"
          :disabled="pixel.superseded"
          data-testid="bpx-buttons-reload"
          @click="loadButtons()"
        />
      </div>

      <div v-if="buttonsPending && !buttonsLoaded" class="space-y-1.5">
        <USkeleton v-for="i in 3" :key="i" class="h-9 w-full" />
      </div>

      <p
        v-else-if="buttonsError"
        class="rounded-md bg-error/10 px-2 py-1.5 text-xs text-error"
        role="alert"
      >
        {{ buttonsError }}
      </p>

      <p
        v-else-if="buttonsLoaded && buttons.length === 0"
        class="rounded-md bg-elevated px-2 py-1.5 text-xs text-muted"
        data-testid="bpx-buttons-empty"
      >
        ยังไม่มีปุ่มบนเว็บ — เพิ่มบล็อกลิงก์ (ปุ่ม) ในตัวแก้ไขเว็บก่อน
      </p>

      <ul
        v-else-if="buttonsLoaded"
        class="max-h-72 space-y-1.5 overflow-y-auto"
        role="radiogroup"
        aria-label="ปุ่มบนเว็บ"
        data-testid="bpx-buttons"
      >
        <li v-for="(b, n) in buttons" :key="`${b.pageId}:${b.blockId}:${b.itemIndex}`">
          <button
            type="button"
            role="radio"
            :aria-checked="picked === n"
            class="flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            :class="picked === n ? 'border-primary bg-primary/10' : 'border-default hover:bg-elevated/60'"
            :disabled="pixel.superseded || jobOpen || posting"
            :data-testid="`bpx-button-${n}`"
            :data-duplicate="b.duplicateText ? 'true' : 'false'"
            @click="picked = n"
          >
            <UIcon
              :name="picked === n ? 'i-lucide-circle-dot' : 'i-lucide-circle'"
              class="mt-0.5 size-4 shrink-0"
              :class="picked === n ? 'text-primary' : 'text-dimmed'"
            />
            <span class="min-w-0 flex-1">
              <span class="block text-xs text-muted">{{ b.pageName }}{{ b.isHome ? ' (หน้าแรก)' : '' }}</span>
              <span class="block break-words font-medium text-highlighted">{{ b.text }}</span>
              <span v-if="b.duplicateText" class="mt-0.5 block text-xs text-warning">{{ BC_PIXEL_TEXT.duplicateText }}</span>
            </span>
          </button>
        </li>
      </ul>

      <p
        v-if="conflict"
        class="rounded-md bg-error/10 px-2 py-1.5 text-xs text-error"
        role="alert"
        data-testid="bpx-event-error"
      >
        {{ conflict }}
      </p>

      <UButton
        v-if="!jobOpen"
        label="สร้าง event"
        icon="i-lucide-mouse-pointer-click"
        color="primary"
        size="sm"
        :loading="posting"
        :disabled="createDisabled"
        data-testid="bpx-event-create"
        @click="createEvent"
      />
    </template>

    <BcPixelsJobCard
      v-if="job && showJob"
      kind="event"
      :job="job"
      :retryable="!pixel.superseded && !pixel.event"
      :retry-blocked-hint="retryBody ? null : 'เลือกปุ่มด้านบนแล้วกด ลองใหม่'"
      :retrying="posting"
      @retry="retry"
    />
  </div>
</template>
