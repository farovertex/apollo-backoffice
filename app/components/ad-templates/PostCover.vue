<script setup lang="ts">
/**
 * FEAT-042 — the cover of the post a Spark template is bound to (api-contract §2.3): a 32 px thumbnail in the
 * `/ad-templates` table and on the `/launch-ads` cards (`thumb`), the bigger image of the post card in the
 * form modal (`card`).
 *
 * `ok` is `postInfo.cover.ok`: the request is issued only while it is true (`useCoverImage`), so this
 * component never produces a 404. Anything else renders the placeholder box — `loading` (spinner), a failed
 * download or no cover at all (image icon) — which keeps the row height stable in every state.
 * `data-state` tells a test which one it is.
 */
const props = withDefaults(defineProps<{
  templateId: string | null | undefined
  /** `postInfo.checkedAt` — part of the cache key, so a re-verify re-fetches the bytes */
  checkedAt?: string | null
  /** `postInfo.cover.ok === true` */
  ok?: boolean
  size?: 'thumb' | 'card'
  testid?: string
}>(), {
  checkedAt: null,
  ok: false,
  size: 'thumb',
  testid: 'adt-post-cover'
})

const { src, loading, error } = useCoverImage(
  () => props.templateId,
  () => props.checkedAt,
  () => props.ok
)

const state = computed(() => {
  if (src.value) return 'ready'
  if (loading.value) return 'loading'
  if (error.value) return 'error'
  return 'none'
})
</script>

<template>
  <div
    class="flex shrink-0 items-center justify-center overflow-hidden rounded bg-elevated"
    :class="size === 'card' ? 'h-28 w-20' : 'size-8'"
    :data-state="state"
    :data-testid="`${testid}-box`"
  >
    <img
      v-if="src"
      :src="src"
      alt=""
      loading="lazy"
      decoding="async"
      class="size-full object-cover"
      :data-testid="testid"
    >
    <UIcon
      v-else
      :name="loading ? 'i-lucide-loader-circle' : 'i-lucide-image-off'"
      class="text-dimmed"
      :class="[size === 'card' ? 'size-6' : 'size-3.5', loading ? 'animate-spin' : '']"
      :title="error ?? undefined"
    />
  </div>
</template>
