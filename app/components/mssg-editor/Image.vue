<script setup lang="ts">
/**
 * FEAT-101 — an image of a draft field (`upload:<id>` read through the API client, or an http(s) URL); a neutral
 * placeholder while loading / when nothing can be shown. Used by the upload field and the mobile preview.
 */
const props = withDefaults(defineProps<{
  siteId: string
  value: string | null | undefined
  alt?: string
}>(), { alt: '' })

const { src, failed } = useMssgImageSrc(() => props.siteId, () => props.value)
</script>

<template>
  <img
    v-if="src"
    :src="src"
    :alt="alt"
    class="object-cover"
    loading="lazy"
  >
  <span
    v-else
    class="flex items-center justify-center bg-current/10"
    :title="failed ? MSSG_UPLOAD_TEXT.previewFailed : undefined"
    aria-hidden="true"
  >
    <UIcon :name="failed ? 'i-lucide-image-off' : 'i-lucide-image'" class="size-5 opacity-50" />
  </span>
</template>
