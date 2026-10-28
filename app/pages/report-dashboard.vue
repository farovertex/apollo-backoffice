<script setup lang="ts">
/**
 * TASK-dashboard-home (2026-10-29): the FEAT-069 dashboard is the home page now (`app/pages/index.vue`). This route
 * only keeps the old `/reports/dashboard` links and bookmarks working — a `replace` redirect to `/` that carries
 * the whole query (`range` / `from` / `to` / `workspaceId` / `chart`) over, so a shared link still opens the same view.
 */
definePageMeta({
  path: '/reports/dashboard',
  middleware: [to => navigateTo({ path: '/', query: to.query }, { replace: true })]
})
</script>

<template>
  <div />
</template>
