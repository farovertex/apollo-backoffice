<script setup lang="ts">
/**
 * FEAT-089 — the post cover of `rp-table` (36×48, `size=sm`) and the detail head (`rp-head`, 96×128,
 * `size=lg`). Same fallback behaviour as `reports/AdThumb.vue` (signed TikTok CDN links expire — a failed
 * load swaps to the placeholder icon, nothing is retried) but a 3:4 box instead of a square.
 */
const props = defineProps<{
  url: string | null
  isVideo: boolean | null
  size?: 'sm' | 'lg'
}>()

const failed = ref(false)
watch(() => props.url, () => {
  failed.value = false
})

const box = computed(() => (props.size === 'lg' ? 'w-24 h-32' : 'w-9 h-12'))
</script>

<template>
  <span
    class="relative flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated"
    :class="box"
    data-testid="rp-cover"
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
      :class="size === 'lg' ? 'size-8' : 'size-4'"
      class="text-dimmed"
    />
    <UIcon
      v-if="url && !failed && isVideo"
      name="i-lucide-play"
      :class="size === 'lg' ? 'size-8' : 'size-4'"
      class="absolute text-white drop-shadow"
    />
  </span>
</template>
