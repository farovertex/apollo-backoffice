<script setup lang="ts">
/**
 * FEAT-040 — the `Reports | Summary | UTM` tab bar (spec U1, AS-4).
 *
 * Plain `NuxtLink`s, not a `UTabs`: these are three routes, not three panels, so a middle click / Cmd-click
 * has to open the page like any other link and the active one is decided by `route.path` alone (never by a
 * local `selected` state that could disagree with the URL after a back button).
 *
 * Mounted on `/reports/utm` **only** (AS-4): `app/pages/reports.vue` and `app/pages/report-summary.vue` are
 * deliberately not edited in this feature — the human can drop `<ReportsTabs />` into them later and the
 * active link will follow without a change here.
 */
const route = useRoute()

const TABS: { label: string, to: string, id: string }[] = [
  { label: 'Reports', to: '/reports', id: 'reports' },
  { label: 'Summary', to: '/reports/summary', id: 'summary' },
  { label: 'UTM', to: '/reports/utm', id: 'utm' }
]

function isActive(to: string): boolean {
  return route.path === to
}
</script>

<template>
  <nav
    class="flex flex-wrap items-center gap-2"
    aria-label="Reports"
    data-testid="ru-tabs"
  >
    <NuxtLink
      v-for="tab in TABS"
      :key="tab.to"
      :to="tab.to"
      :aria-current="isActive(tab.to) ? 'page' : undefined"
      :data-testid="`ru-tab-${tab.id}`"
      :data-active="isActive(tab.to) ? 'true' : 'false'"
      class="rounded-md border px-3 py-1 text-sm font-medium transition-colors"
      :class="isActive(tab.to)
        ? 'border-primary bg-primary text-inverted'
        : 'border-default text-muted hover:bg-elevated hover:text-default'"
    >
      {{ tab.label }}
    </NuxtLink>
  </nav>
</template>
