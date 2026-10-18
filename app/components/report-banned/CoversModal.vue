<script setup lang="ts">
/**
 * TASK-banned-ad-covers (API contract v1 §2, BO surface) — every ad image of one banned advertiser, opened
 * from the row's eye button (`rb-row-covers-btn`). The page owns the open row; this component only fetches
 * and renders.
 *
 * `GET /reports/banned/:advertiserId/ads` on every open (`useApi()`, `retry: 0`). The session counter (same
 * pattern as `tiktok-accounts/CardsModal.vue`) drops a late answer once the modal is closed or the page opens
 * a different row before the request lands.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { BannedAdsResponse, BannedRow } from '#shared/types/report-banned'

const props = defineProps<{
  /** the row the eye button was clicked on; null while the modal is closed */
  row: BannedRow | null
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()

const modalContent = { 'data-testid': 'rb-covers-modal' } as ModalProps['content']

const data = ref<BannedAdsResponse | null>(null)
const pending = ref(false)
const loaded = ref(false)
const errorText = ref<string | null>(null)
/** per-ad image failures (signed CDN links expire — same rule as `ReportsAdThumb`) */
const failedIds = ref<Set<string>>(new Set())
let session = 0

const advertiserName = computed(() => data.value?.advertiser.name ?? props.row?.advertiser.name ?? null)
const tiktokAdvertiserId = computed(() => data.value?.advertiser.tiktokAdvertiserId ?? props.row?.advertiser.tiktokAdvertiserId ?? null)
const count = computed(() => data.value?.total ?? props.row?.adCount ?? 0)

const title = computed(() => `รูปโฆษณา · ${advertiserName.value || REPORT_DASH}`)
const subtitle = computed(() => `aadvid ${last4(tiktokAdvertiserId.value)} · ${formatInt(count.value)} โฆษณา`)

async function load() {
  const id = props.row?.advertiser.id
  if (!id) return
  const s = ++session
  pending.value = true
  errorText.value = null
  try {
    // retry: 0 — exactly one request per open / retry click
    const res = await api<BannedAdsResponse>(`/reports/banned/${encodeURIComponent(id)}/ads`, { retry: 0 })
    if (s !== session) return
    data.value = res
    loaded.value = true
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    data.value = null
    errorText.value = err.data?.error ?? err.message ?? 'โหลดรูปโฆษณาไม่สำเร็จ'
  } finally {
    if (s === session) pending.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    data.value = null
    loaded.value = false
    errorText.value = null
    failedIds.value = new Set()
    void load()
  } else {
    // drops a late answer of a now-closed modal
    session++
  }
})

function markFailed(id: string) {
  failedIds.value = new Set(failedIds.value).add(id)
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="subtitle"
    :ui="{ content: 'sm:max-w-3xl' }"
    :content="modalContent"
  >
    <template #body>
      <div v-if="pending && !loaded" class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" data-testid="rb-covers-loading">
        <USkeleton v-for="n in 8" :key="n" class="aspect-3/4 w-full rounded-lg" />
      </div>

      <UAlert
        v-else-if="errorText"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="โหลดรูปโฆษณาไม่สำเร็จ"
        :description="errorText"
        data-testid="rb-covers-error"
      >
        <template #actions>
          <UButton
            label="Retry"
            icon="i-lucide-refresh-cw"
            color="error"
            size="xs"
            :loading="pending"
            data-testid="rb-covers-retry"
            @click="load()"
          />
        </template>
      </UAlert>

      <UEmpty
        v-else-if="loaded && (data?.ads.length ?? 0) === 0"
        icon="i-lucide-image-off"
        title="ไม่มีรูปโฆษณา"
        data-testid="rb-covers-empty"
      />

      <div
        v-else-if="loaded"
        class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
        data-testid="rb-covers-grid"
      >
        <div
          v-for="ad in data?.ads ?? []"
          :key="ad.id"
          class="flex min-w-0 flex-col gap-1"
          data-testid="rb-cover"
          :data-id="ad.id"
        >
          <span class="relative flex aspect-3/4 w-full items-center justify-center overflow-hidden rounded-lg bg-elevated">
            <img
              v-if="ad.media.coverUrl && !failedIds.has(ad.id)"
              :src="ad.media.coverUrl"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
              class="size-full object-cover"
              @error="markFailed(ad.id)"
            >
            <UIcon
              v-else
              :name="ad.media.isVideo ? 'i-lucide-play' : 'i-lucide-image'"
              class="size-6 text-dimmed"
            />
            <UIcon
              v-if="ad.media.coverUrl && !failedIds.has(ad.id) && ad.media.isVideo"
              name="i-lucide-play"
              class="absolute size-6 text-white drop-shadow"
            />
          </span>
          <span class="truncate text-xs font-medium text-highlighted" :title="ad.creativeName">
            {{ ad.creativeName || REPORT_DASH }}
          </span>
          <span class="truncate text-xs text-muted" :title="ad.adGroupName">
            {{ ad.adGroupName || REPORT_DASH }}
          </span>
        </div>
      </div>
    </template>
  </UModal>
</template>
