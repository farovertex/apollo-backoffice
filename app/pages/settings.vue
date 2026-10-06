<script setup lang="ts">
/**
 * Settings area of the dashboard template (tab bar + `<NuxtPage/>` for `app/pages/settings/*`).
 *
 * FEAT-030 (spec AS-13): the tab list is a **computed** over the session so the GOD-only `Auto top-up` tab
 * (after `Security`) is rendered for a GOD admin only. The route itself stays registered — `god-only` on
 * `app/pages/settings/auto-topup.vue` is the guard, and the API (`@Roles('GOD')`) is the authority.
 */
import type { NavigationMenuItem } from '@nuxt/ui'

const { admin } = useAuth()

const isGod = computed(() => admin.value?.roles?.includes('GOD') === true)

const links = computed<NavigationMenuItem[][]>(() => [[{
  label: 'General',
  icon: 'i-lucide-user',
  to: '/settings',
  exact: true
}, {
  label: 'Members',
  icon: 'i-lucide-users',
  to: '/settings/members'
}, {
  label: 'Notifications',
  icon: 'i-lucide-bell',
  to: '/settings/notifications'
}, {
  label: 'Security',
  icon: 'i-lucide-shield',
  to: '/settings/security'
}, ...(isGod.value
  ? [{
      label: 'Auto top-up',
      icon: 'i-lucide-zap',
      to: '/settings/auto-topup'
    }]
  : [])], [{
  label: 'Documentation',
  icon: 'i-lucide-book-open',
  to: 'https://ui.nuxt.com/docs/getting-started/installation/nuxt',
  target: '_blank'
}]])
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
