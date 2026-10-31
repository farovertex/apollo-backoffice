<script setup lang="ts">
/**
 * FEAT-089 — the post cover of `rp-table` (36×48, `size=sm`) and the detail head (`rp-head`, 96×128,
 * `size=lg`). Same fallback behaviour as `reports/AdThumb.vue` (signed TikTok CDN links expire — a failed
 * load swaps to the placeholder icon, nothing is retried) but a 3:4 box instead of a square.
 *
 * BUG-076 — `url` can be two different things (contract §1.1):
 * - a TikTok CDN link (`subject.media.coverUrl`): a plain absolute URL, `<img>` loads it directly, unchanged;
 * - the API's own cover route, `/ad-templates/<templateId>/cover` (emitted only while `postInfo.cover.ok`):
 *   that path is relative to the **BO** origin (404 there) and even through the `/backend` proxy it answers
 *   JSON (`{ mimeType, url|base64 }`, FEAT-048), never image bytes — a plain `<img src>` can never render it.
 *   Those must go through `useCoverImage` exactly like `ad-templates/PostCover.vue` does. `checkedAt` is not
 *   known on this row (the list/detail response doesn't carry it here), so it is passed as `null` on every
 *   call — a stable cache key, just never invalidated by a re-verify from this screen.
 *
 * v1.1 (AC-24) — `kind` of `adGroupTemplate`/`account` always sends `url: null`: those subjects have no cover
 * of their own, so this component renders a lens icon instead and never calls `useCoverImage` at all (the
 * `enabled` guard below is `false` for those kinds even if a stray url were ever present).
 */
const TEMPLATE_COVER_RE = /^\/ad-templates\/([0-9a-f]{24})\/cover$/

const props = defineProps<{
  url: string | null
  isVideo: boolean | null
  kind?: 'post' | 'adTemplate' | 'adGroupTemplate' | 'account'
  size?: 'sm' | 'lg'
}>()

const isLensKind = computed(() => props.kind === 'adGroupTemplate' || props.kind === 'account')

const templateCoverId = computed(() => (isLensKind.value ? null : TEMPLATE_COVER_RE.exec(props.url ?? '')?.[1] ?? null))

const { src: templateSrc, error: templateError, retry: retryTemplateCover } = useCoverImage(
  templateCoverId,
  null,
  () => templateCoverId.value !== null
)

// direct CDN `<img>` failure (non-template url) — unchanged behaviour
const failed = ref(false)
watch(() => props.url, () => {
  failed.value = false
})

// `<img>`-level failure of the resolved template cover src (presigned URL can 403/expire after the
// composable's own request succeeded) — one retry, same pattern as `PostCover.vue`: the first failure
// drops the cache and refetches; a second failure on the (possibly new) src is a hard failure regardless
// of whether the composable itself reports an `error` (a stale cache key reset is not an error on its own,
// so the fallback can't depend on `templateError`, same lesson as `PostCover.vue`'s own `imgFailCount`).
const templateImgFailCount = ref(0)
const templateImgHardFailed = ref(false)
watch(templateCoverId, () => {
  templateImgFailCount.value = 0
  templateImgHardFailed.value = false
})

function onImgError() {
  if (templateCoverId.value) {
    templateImgFailCount.value++
    if (templateImgFailCount.value === 1) {
      retryTemplateCover()
      return
    }
    templateImgHardFailed.value = true
    return
  }
  failed.value = true
}

const effectiveSrc = computed(() => (templateCoverId.value ? templateSrc.value : props.url))
const effectiveFailed = computed(() => (templateCoverId.value ? (templateImgHardFailed.value || !!templateError.value) : failed.value))

const box = computed(() => (props.size === 'lg' ? 'w-24 h-32' : 'w-9 h-12'))

const lensIcon = computed(() => (props.kind === 'account' ? 'i-lucide-user-round' : 'i-lucide-layout-template'))
const lensDataKind = computed(() => (props.kind === 'account' ? 'account' : 'template'))
</script>

<template>
  <span
    v-if="isLensKind"
    class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated"
    :class="box"
    data-testid="rp-cover"
    :data-kind="lensDataKind"
  >
    <UIcon
      :name="lensIcon"
      :class="size === 'lg' ? 'size-8' : 'size-4'"
      class="text-dimmed"
    />
  </span>
  <span
    v-else
    class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated"
    :class="box"
    data-testid="rp-cover"
    :data-kind="isVideo ? 'video' : 'image'"
  >
    <img
      v-if="effectiveSrc && !effectiveFailed"
      :src="effectiveSrc"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      class="size-full object-cover"
      @error="onImgError"
    >
    <UIcon
      v-else
      :name="isVideo ? 'i-lucide-play' : 'i-lucide-image'"
      :class="size === 'lg' ? 'size-8' : 'size-4'"
      class="text-dimmed"
    />
    <UIcon
      v-if="effectiveSrc && !effectiveFailed && isVideo"
      name="i-lucide-play"
      :class="size === 'lg' ? 'size-8' : 'size-4'"
      class="absolute text-white drop-shadow"
    />
  </span>
</template>
