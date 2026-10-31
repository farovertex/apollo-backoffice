<script setup lang="ts">
/**
 * FEAT-042 — the cover of the post a Spark template is bound to (api-contract §2.3): a 32 px thumbnail on the
 * `/launch-ads` cards (`thumb`), a 9:16 `row` image in the `/ad-templates` table (the post column has no code
 * text any more, the image is the column), the bigger image of the post card in the form modal (`card`).
 *
 * `ok` is `postInfo.cover.ok`: the request is issued only while it is true (`useCoverImage`), so this
 * component never produces a 404. Anything else renders the placeholder box — `loading` (spinner), a failed
 * download or no cover at all (image icon) — which keeps the row height stable in every state.
 * `data-state` tells a test which one it is.
 *
 * FEAT-048 — `src` may now be a presigned URL instead of a data URI, so the browser's own `<img>` fetch of it
 * can fail (expired/403) even after the composable's own request succeeded. One `@error` calls the
 * composable's `retry()` (drops the cache entry, refetches the endpoint once); a second `@error` on the new
 * `src` is treated as a hard failure (`data-state="error"`, title "โหลดรูปปกไม่ได้") instead of retrying again.
 * The guard resets on template id / `checkedAt` change, never on the retry's own src churn.
 *
 * TASK-orders-post-guard — `video` overlays a small play icon on the cover (same idea as
 * `report-posts/Cover.vue`'s own overlay), only while a real image is shown; default `false` so every existing
 * caller renders unchanged.
 */
const props = withDefaults(defineProps<{
  templateId: string | null | undefined
  /** `postInfo.checkedAt` — part of the cache key, so a re-verify re-fetches the bytes */
  checkedAt?: string | null
  /** `postInfo.cover.ok === true` */
  ok?: boolean
  /** FEAT-062 — `preview` (112×200, 9:16, ≈1.4× `card`) is the Summary/Review preview of `/launch-ads` */
  size?: 'thumb' | 'row' | 'card' | 'preview'
  testid?: string
  /** TASK-orders-post-guard — `itemType === 0` of the bound post */
  video?: boolean
}>(), {
  checkedAt: null,
  ok: false,
  size: 'thumb',
  testid: 'adt-post-cover',
  video: false
})

const { src, loading, error, retry } = useCoverImage(
  () => props.templateId,
  () => props.checkedAt,
  () => props.ok
)

const BOX_CLASS = { thumb: 'size-8', row: 'h-14 w-10', card: 'h-28 w-20', preview: 'h-50 w-28' } as const
const ICON_CLASS = { thumb: 'size-3.5', row: 'size-4', card: 'size-6', preview: 'size-8' } as const

/** `<img>` load-failure guard — keyed on identity, not on `src` (which churns on retry itself). */
const cacheKey = computed(() => `${props.templateId ?? ''}|${props.checkedAt ?? ''}`)
const imgFailCount = ref(0)
const imgError = ref<string | null>(null)
watch(cacheKey, () => {
  imgFailCount.value = 0
  imgError.value = null
})

function onImgError() {
  imgFailCount.value++
  if (imgFailCount.value === 1) {
    retry()
    return
  }
  imgError.value = 'โหลดรูปปกไม่ได้'
}

const state = computed(() => {
  if (imgError.value) return 'error'
  if (src.value) return 'ready'
  if (loading.value) return 'loading'
  if (error.value) return 'error'
  return 'none'
})
</script>

<template>
  <div
    class="relative flex shrink-0 items-center justify-center overflow-hidden rounded bg-elevated"
    :class="BOX_CLASS[size]"
    :data-state="state"
    :data-testid="`${testid}-box`"
  >
    <img
      v-if="src && !imgError"
      :src="src"
      alt=""
      loading="lazy"
      decoding="async"
      class="size-full object-cover"
      :data-testid="testid"
      @error="onImgError"
    >
    <UIcon
      v-else
      :name="loading ? 'i-lucide-loader-circle' : 'i-lucide-image-off'"
      class="text-dimmed"
      :class="[ICON_CLASS[size], loading ? 'animate-spin' : '']"
      :title="imgError ?? error ?? undefined"
    />
    <UIcon
      v-if="src && !imgError && video"
      name="i-lucide-play"
      class="absolute text-white drop-shadow"
      :class="ICON_CLASS[size]"
      :data-testid="`${testid}-video`"
    />
  </div>
</template>
