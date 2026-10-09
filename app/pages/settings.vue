<script setup lang="ts">
/**
 * Settings area (tab bar + `<NuxtPage/>` for `app/pages/settings/*`).
 *
 * BUG-037: the dashboard-template tabs (General / Members / Notifications / Security) and the Documentation
 * link were unimplemented sample content and are gone. The implemented screens are the GOD-only
 * `Auto top-up` tab from FEAT-030 (spec AS-13) and the GOD-only `UTM` tab from FEAT-038 (spec U3/AS-9) —
 * kept as a **computed** over the session so they only render for a GOD admin. The routes themselves stay
 * registered — `god-only` on each `app/pages/settings/*.vue` is the guard, and the API (`@Roles('GOD')`) is
 * the authority.
 */
import type { NavigationMenuItem } from '@nuxt/ui'

const { admin } = useAuth()

const isGod = computed(() => admin.value?.roles?.includes('GOD') === true)

const links = computed<NavigationMenuItem[][]>(() => [[...(isGod.value
  ? [{
      label: 'Auto top-up',
      icon: 'i-lucide-zap',
      to: '/settings/auto-topup'
    }, {
      label: 'UTM',
      icon: 'i-lucide-link',
      to: '/settings/utm'
    }]
  : [])]])
</script>

<template>
  <UDashboardPanel id="settings" :ui="{ body: 'lg:py-12' }">
    <template #header>
      <UDashboardNavbar title="Settings">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>

      <UDashboardToolbar>
        <!-- NOTE: The `-mx-1` class is used to align with the `DashboardSidebarCollapse` button here. -->
        <!-- BUG-001: let the tab groups (root) and tabs (list) wrap on narrow viewports instead of overflowing the toolbar -->
        <UNavigationMenu
          :items="links"
          highlight
          class="-mx-1 flex-1"
          :ui="{ root: 'flex-wrap', list: 'flex-wrap' }"
        />
      </UDashboardToolbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full lg:max-w-2xl mx-auto">
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
