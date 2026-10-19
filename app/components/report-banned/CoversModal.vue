<script setup lang="ts">
/**
 * TASK-banned-ad-covers (API contract v1 §2, BO surface) — every ad image of one banned advertiser, opened
 * from the row's eye button (`rb-row-covers-btn`). The page owns the open row; this component only fetches
 * and renders.
 *
 * `GET /reports/banned/:advertiserId/ads` on every open (`useApi()`, `retry: 0`). The session counter (same
 * pattern as `tiktok-accounts/CardsModal.vue`) drops a late answer once the modal is closed or the page opens
 * a different row before the request lands.
 *
 * FEAT-056 T11 — the grid itself moved to `reports/CoversGrid.vue` (shared with `ads-monitor/CoversModal.vue`);
 * this component keeps its own title/subtitle, fetch and `rb-covers-*` testids unchanged.
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
    void load()
  } else {
    // drops a late answer of a now-closed modal
    session++
  }
})
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
      <ReportsCoversGrid
        :pending="pending"
        :loaded="loaded"
        :error-text="errorText"
        :ads="data?.ads ?? []"
        testid-loading="rb-covers-loading"
        testid-error="rb-covers-error"
        testid-retry="rb-covers-retry"
        testid-empty="rb-covers-empty"
        testid-grid="rb-covers-grid"
        testid-item="rb-cover"
        @retry="load()"
      />
    </template>
  </UModal>
</template>
