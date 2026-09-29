<script setup lang="ts">
/**
 * FEAT-020 — creative thumbnail. The URL is a signed TikTok CDN link of the last fetch and expires
 * (spec A5, limitation L-5), so a load failure is expected and must not look like a broken page: the
 * `error` event swaps the image for the placeholder icon and nothing is retried.
 */
const props = defineProps<{
  url: string | null
  isVideo: boolean
  size?: 'sm' | 'md'
}>()

const failed = ref(false)
watch(() => props.url, () => {
  failed.value = false
})

const box = computed(() => (props.size === 'md' ? 'size-14' : 'size-9'))
</script>

<template>
  <span
    class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated"
    :class="box"
    data-testid="rp-thumb"
    :data-kind="isVideo ? 'video' : 'image'"
  >
    <img
      v-if="url && !failed"
      :src="url"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      class="size-full object-cover"
      @error="failed = true"
    >
    <UIcon
      v-else
      :name="isVideo ? 'i-lucide-play' : 'i-lucide-image'"
      class="size-4 text-dimmed"
    />
    <UIcon
      v-if="url && !failed && isVideo"
      name="i-lucide-play"
      class="absolute size-4 text-white drop-shadow"
    />
  </span>
</template>
