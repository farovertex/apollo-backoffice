<script setup lang="ts">
/**
 * FEAT-056 T11 (api-contract.md v1.3 §8.3, spec "Human change 2026-10-19 14:00") — every ad image of one
 * campaign, opened from the campaign tab's eye button (`am-row-covers-btn`). Mirrors
 * `report-banned/CoversModal.vue` (TASK-banned-ad-covers) one for one and reuses its grid
 * (`reports/CoversGrid.vue`) instead of duplicating the markup.
 *
 * `GET /ads-monitor/campaigns/:advertiserId/:tiktokCampaignId/ads` on every open (`useApi()`, `retry: 0`).
 * The session counter drops a late answer once the modal is closed or the page opens a different campaign
 * row before the request lands.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { MonitorCampaignAdsResponse, MonitorRow } from '#shared/types/ads-monitor'
import type { ApiErrorBody } from '#shared/types/auth'

const props = defineProps<{
  /** the campaign row the eye button was clicked on; null while the modal is closed */
  row: MonitorRow | null
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()

const modalContent = { 'data-testid': 'am-covers-modal' } as ModalProps['content']

const data = ref<MonitorCampaignAdsResponse | null>(null)
const pending = ref(false)
const loaded = ref(false)
const errorText = ref<string | null>(null)
let session = 0

const campaignName = computed(() => data.value?.campaign.name ?? props.row?.name ?? REPORT_DASH)
const count = computed(() => data.value?.total ?? props.row?.adCount ?? 0)

const title = computed(() => campaignName.value || REPORT_DASH)
const subtitle = computed(() => `${formatInt(count.value)} โฆษณา`)

async function load() {
  const advertiserId = props.row?.advertiser.id
  const tiktokCampaignId = props.row?.id
  if (!advertiserId || !tiktokCampaignId) return
  const s = ++session
  pending.value = true
  errorText.value = null
  try {
    // retry: 0 — exactly one request per open / retry click
    const res = await api<MonitorCampaignAdsResponse>(
      `/ads-monitor/campaigns/${encodeURIComponent(advertiserId)}/${encodeURIComponent(tiktokCampaignId)}/ads`,
      { retry: 0 }
    )
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
        testid-loading="am-covers-loading"
        testid-error="am-covers-error"
        testid-retry="am-covers-retry"
        testid-empty="am-covers-empty"
        testid-grid="am-covers-grid"
        testid-item="am-cover"
        @retry="load()"
      />
    </template>
  </UModal>
</template>
