<script setup lang="ts">
/**
 * `/settings` has no content of its own (BUG-037). FEAT-076 (spec "UI behaviour", A6): the landing tab depends on
 * the role — GOD → `/settings/auto-topup` (unchanged, the smoke spec relies on it), Admin → `/settings/prefixes`
 * (the only tab an Admin has), anybody else (Payment) → `prefixes-access` sends them home with the "Not allowed"
 * toast before the inline redirect runs.
 */
definePageMeta({
  middleware: ['prefixes-access', () => {
    const { admin } = useAuth()
    const isGod = admin.value?.roles.includes('GOD') === true
    return navigateTo(isGod ? '/settings/auto-topup' : '/settings/prefixes', { replace: true })
  }]
})
</script>

<template>
  <div />
</template>
