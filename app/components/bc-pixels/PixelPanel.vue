<script setup lang="ts">
/**
 * FEAT-102 (spec "UI behaviour → Panel / Live updates", AC-23; api-contract §3.5, §7.2, §7.4 panel ids).
 * The slideover of one pixel (`bpx-panel`, full width on mobile). It owns the pixel's view: one
 * `GET /bc-pixels/:id` when it opens (or the pixel changes), then a 2 s poll of the same route while
 * `pixelNeedsPoll(view)` — `busy`, or the latest run `running|stopping`, or its verify step `waiting` (§7.2) —
 * one loop, never two requests in flight, cleared when nothing is open, on close and on unmount.
 * Every step component POSTs on its own and hands the 202 view back (`updated`), which restarts the poll.
 * Emits `update` with every view it reads (the page patches its row) and `settled` once when the pixel goes from
 * polling to idle (the page re-reads the list once). A superseded pixel shows "pixel เก่า"; the steps disable their
 * actions themselves (only step 4's unlink stays enabled — B2).
 */
import type { PixelView, PixelViewResponse } from '#shared/types/bc-pixels'

const props = defineProps<{
  pixelId: string | null
}>()

const emit = defineEmits<{
  update: [view: PixelView]
  settled: [view: PixelView]
}>()

const open = defineModel<boolean>('open', { default: false })
const slideoverContent = { 'data-testid': 'bpx-panel' } as Record<string, unknown>

const api = useApi()
const { copy, copied } = useClipboard({ legacy: true })

const view = ref<PixelView | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)

/** bumped on every pixel switch / close: a late answer for another pixel is dropped */
let seq = 0
/** the `seq` whose request is in flight (never two requests for the same pixel at once) */
let inFlight: number | null = null
let timer: ReturnType<typeof setInterval> | null = null

function stopPoll() {
  if (timer) clearInterval(timer)
  timer = null
}

function syncPoll() {
  const should = open.value && !!view.value && pixelNeedsPoll(view.value)
  if (should && !timer) timer = setInterval(() => void read(), BC_PIXEL_POLL_MS)
  else if (!should) stopPoll()
}

function apply(next: PixelView) {
  if (next.id !== props.pixelId) return
  const prev = view.value
  view.value = next
  loadError.value = null
  emit('update', next)
  if (prev && prev.id === next.id && pixelNeedsPoll(prev) && !pixelNeedsPoll(next)) emit('settled', next)
  syncPoll()
}

async function read() {
  const id = props.pixelId
  if (!id || inFlight === seq) return
  const s = seq
  inFlight = s
  try {
    // retry: 0 — one request per tick
    const res = await api<PixelViewResponse>(`/bc-pixels/${encodeURIComponent(id)}`, { retry: 0 })
    if (s !== seq) return
    apply(res.pixel)
  } catch (e) {
    if (s !== seq) return
    const f = bcPixelFailure(e, 'โหลดข้อมูล pixel ไม่สำเร็จ')
    // a failed tick keeps the last view on screen; only a first read without a view shows the error state,
    // and a 404 (gone / out of scope) always does
    if (!view.value || f.status === 404) {
      view.value = null
      loadError.value = f.status === 404 ? (f.body?.error ?? 'ไม่พบ pixel') : f.message
      stopPoll()
    }
  } finally {
    if (inFlight === s) inFlight = null
    if (s === seq) loading.value = false
  }
}

function reset() {
  seq++
  inFlight = null
  stopPoll()
  view.value = null
  loadError.value = null
}

watch([open, () => props.pixelId], ([isOpen, id]) => {
  reset()
  if (isOpen && id) {
    loading.value = true
    void read()
  } else {
    loading.value = false
  }
}, { immediate: true })

onUnmounted(() => {
  seq++
  stopPoll()
})

function retryLoad() {
  loading.value = true
  loadError.value = null
  void read()
}

function siteHref(url: string): string | undefined {
  return /^https?:\/\//i.test(url) ? url : undefined
}

const steps = computed(() => view.value?.steps ?? null)
</script>

<template>
  <USlideover
    v-model:open="open"
    :content="slideoverContent"
    :ui="{ content: 'w-full max-w-full sm:max-w-xl' }"
  >
    <template #header>
      <div class="flex w-full min-w-0 items-start gap-2">
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="min-w-0 truncate text-base font-semibold text-highlighted">
              {{ view?.name ?? 'Pixel' }}
            </h2>
            <UBadge
              v-if="view?.superseded"
              color="neutral"
              variant="solid"
              size="sm"
              data-testid="bpx-superseded-badge"
            >
              {{ BC_PIXEL_TEXT.superseded }}
            </UBadge>
          </div>
          <template v-if="view">
            <p class="flex flex-wrap items-center gap-1 text-xs text-muted">
              <span class="font-mono break-all">{{ view.pixelCode }}</span>
              <UButton
                :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="คัดลอกโค้ด pixel"
                @click="copy(view.pixelCode)"
              />
            </p>
            <p class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
              <span class="inline-flex min-w-0 items-center gap-1">
                <UIcon name="i-lucide-globe" class="size-3.5 shrink-0" />
                <a
                  v-if="siteHref(view.site.url) && !view.siteGone"
                  :href="siteHref(view.site.url)"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="truncate text-primary hover:underline"
                >{{ view.site.name || view.site.domain }} · {{ view.site.domain }}</a>
                <span v-else class="truncate">{{ view.site.name || view.site.domain }} · {{ view.site.domain }}</span>
              </span>
              <span class="inline-flex min-w-0 items-center gap-1">
                <UIcon name="i-lucide-building-2" class="size-3.5 shrink-0" />
                <span class="truncate">{{ bcPixelOrgText(view.org) }} · {{ view.account.label }}</span>
              </span>
            </p>
          </template>
        </div>
        <UButton
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          aria-label="ปิด"
          data-testid="bpx-panel-close"
          @click="open = false"
        />
      </div>
    </template>

    <template #body>
      <div v-if="loading && !view" class="flex flex-col gap-3" data-testid="bpx-panel-loading">
        <USkeleton v-for="i in 5" :key="i" class="h-20 w-full" />
      </div>

      <div
        v-else-if="loadError && !view"
        class="flex flex-col items-center gap-3 py-10 text-center"
        data-testid="bpx-panel-error"
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
          data-testid="bpx-panel-retry"
          @click="retryLoad"
        />
      </div>

      <div v-else-if="view && steps" class="flex flex-col gap-3">
        <p
          v-if="view.superseded"
          class="rounded-md bg-elevated px-3 py-2 text-xs text-muted"
        >
          {{ BC_PIXEL_CONFLICT_TEXT.superseded }} · {{ bcPixelDateTime(view.supersededAt) }} — เหลือเพียงการเลิกผูกบัญชี
        </p>

        <BcPixelsStepCard step-key="create" :index="1" :state="steps.create">
          <p class="text-muted">
            สร้างเมื่อ {{ bcPixelDateTime(view.createdAt) }}
            <template v-if="view.createdBy">
              โดย {{ view.createdBy.displayName }}
            </template>
            · asset …{{ view.assetIdLast4 }}
          </p>
        </BcPixelsStepCard>

        <BcPixelsStepCard step-key="install" :index="2" :state="steps.install">
          <BcPixelsInstallStep :pixel="view" @updated="apply" @reload="read" />
        </BcPixelsStepCard>

        <BcPixelsStepCard step-key="event" :index="3" :state="steps.event">
          <BcPixelsEventStep :pixel="view" @updated="apply" @reload="read" />
        </BcPixelsStepCard>

        <BcPixelsStepCard step-key="link" :index="4" :state="steps.link">
          <BcPixelsLinkStep :pixel="view" />
        </BcPixelsStepCard>

        <BcPixelsStepCard step-key="activate" :index="5" :state="steps.activate">
          <BcPixelsActivateStep :pixel="view" />
        </BcPixelsStepCard>
      </div>
    </template>

    <template #footer>
      <p class="w-full text-right text-[11px] text-dimmed">
        ปิดแผงนี้ได้ งานยังทำต่อ · อัปเดตทุก 2 วิ ขณะมีงานทำอยู่
      </p>
    </template>
  </USlideover>
</template>
