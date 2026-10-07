<script setup lang="ts">
/**
 * `/settings` has no content of its own — the only implemented settings screen is the GOD-only Auto top-up
 * page (FEAT-030, BUG-037). `god-only` runs first and sends a non-GOD admin home with the same "Not allowed"
 * toast as typing `/settings/auto-topup` directly; a GOD admin falls through to the inline redirect below.
 */
definePageMeta({
  middleware: ['god-only', () => navigateTo('/settings/auto-topup', { replace: true })]
})
</script>

<template>
  <div />
</template>
