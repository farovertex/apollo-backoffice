<script setup lang="ts">
/**
 * Shared "all ad images" grid, extracted out of `report-banned/CoversModal.vue` (TASK-banned-ad-covers) so
 * `ads-monitor/CoversModal.vue` (FEAT-056 T11, api-contract.md v1.3 §8.3) does not duplicate the markup. Pure
 * render: loading skeleton / error + retry / empty / grid of thumbnails. The owning modal does the fetching
 * and session handling, and passes its own already-tested `data-testid`s (`rb-covers-*` / `am-covers-*`)
 * through props so neither page's testids move.
 */
export interface CoverGridAd {
  id: string
  /** omitted entirely on levels that have no caption line (kept optional on purpose) */
  creativeName?: string | null
  adGroupName?: string | null
  media: { coverUrl: string | null, isVideo: boolean }
}

const props = withDefaults(defineProps<{
  pending: boolean
  loaded: boolean
  errorText: string | null
  ads: CoverGridAd[]
  testidLoading?: string
  testidError?: string
  testidRetry?: string
  testidEmpty?: string
  testidGrid?: string
  testidItem?: string
}>(), {
  testidLoading: 'covers-loading',
  testidError: 'covers-error',
  testidRetry: 'covers-retry',
  testidEmpty: 'covers-empty',
  testidGrid: 'covers-grid',
  testidItem: 'cover'
})

const emit = defineEmits<{ retry: [] }>()

/** per-ad image failures (signed CDN links expire) — reset whenever the modal loads a fresh ad list */
const failedIds = ref<Set<string>>(new Set())
watch(() => props.ads, () => {
  failedIds.value = new Set()
})

function markFailed(id: string) {
  failedIds.value = new Set(failedIds.value).add(id)
}
</script>

<template>
  <div v-if="pending && !loaded" class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" :data-testid="testidLoading">
    <USkeleton v-for="n in 8" :key="n" class="aspect-3/4 w-full rounded-lg" />
  </div>

  <UAlert
    v-else-if="errorText"
    color="error"
    variant="subtle"
    icon="i-lucide-triangle-alert"
    title="โหลดรูปโฆษณาไม่สำเร็จ"
    :description="errorText"
    :data-testid="testidError"
  >
    <template #actions>
      <UButton
        label="Retry"
        icon="i-lucide-refresh-cw"
        color="error"
        size="xs"
        :loading="pending"
        :data-testid="testidRetry"
        @click="emit('retry')"
      />
    </template>
  </UAlert>

  <UEmpty
    v-else-if="loaded && ads.length === 0"
    icon="i-lucide-image-off"
    title="ไม่มีรูปโฆษณา"
    :data-testid="testidEmpty"
  />

  <div
    v-else-if="loaded"
    class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4"
    :data-testid="testidGrid"
  >
    <div
      v-for="ad in ads"
      :key="ad.id"
      class="flex min-w-0 flex-col gap-1"
      :data-testid="testidItem"
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
      <span v-if="ad.creativeName !== undefined" class="truncate text-xs font-medium text-highlighted" :title="ad.creativeName ?? ''">
        {{ ad.creativeName || REPORT_DASH }}
      </span>
      <span v-if="ad.adGroupName !== undefined" class="truncate text-xs text-muted" :title="ad.adGroupName ?? ''">
        {{ ad.adGroupName || REPORT_DASH }}
      </span>
    </div>
  </div>
</template>
