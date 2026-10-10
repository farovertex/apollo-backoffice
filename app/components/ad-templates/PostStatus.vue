<script setup lang="ts">
/**
 * FEAT-042 — the post-info chip of a Spark ad template (spec §Behaviour — BO): `adt-post-status` in the form
 * modal and in the `/ad-templates` table, `la-adt-post-status` on the ad-template cards of `/launch-ads`.
 * Labels and colours come from `postInfoBadge()`; **every chip carries `data-status`** (the API's status, or
 * `none` for a template that was never checked). `verifying` additionally spins.
 * The chip never shows the Spark code.
 */
import type { PostInfoLike } from '~/utils/post-info'

const props = withDefaults(defineProps<{
  postInfo: PostInfoLike
  testid?: string
  size?: 'sm' | 'md'
}>(), {
  testid: 'adt-post-status',
  size: 'sm'
})

const badge = computed(() => postInfoBadge(props.postInfo))
const verifying = computed(() => isPostInfoVerifying(props.postInfo))
</script>

<template>
  <UBadge
    :color="badge.color"
    variant="subtle"
    :size="size"
    class="whitespace-nowrap"
    :data-testid="testid"
    :data-status="postInfoStatusAttr(postInfo)"
  >
    <UIcon
      v-if="verifying"
      name="i-lucide-loader-circle"
      class="size-3 animate-spin"
    />
    {{ badge.label }}
  </UBadge>
</template>
