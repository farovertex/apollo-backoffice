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
 * FEAT-076 — third tab `Prefixes` (`/settings/prefixes`, GOD + Admin; an Admin sees only that tab).
 * FEAT-077 — fourth tab `Telegram` (`/settings/telegram`, GOD only, after `Prefixes`).
 */
import type { NavigationMenuItem } from '@nuxt/ui'

const { admin } = useAuth()
const route = useRoute()
// FEAT-076 — the Prefixes table has 7 columns; it gets a wider column than the form-style tabs
const wide = computed(() => route.path.startsWith('/settings/prefixes'))

const isGod = computed(() => admin.value?.roles?.includes('GOD') === true)
const isAdmin = computed(() => admin.value?.roles?.includes('Admin') === true)

// FEAT-076 — `Prefixes` (`prefixes-access`: GOD edits, Admin reads); an Admin sees only this tab
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
  : []), ...(isGod.value || isAdmin.value
  ? [{
      label: 'Prefixes',
      icon: 'i-lucide-tag',
      to: '/settings/prefixes'
    }]
  : []), ...(isGod.value
  ? [{
      label: 'Telegram',
      icon: 'i-lucide-send',
      to: '/settings/telegram'
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
      <div
        class="flex flex-col gap-4 sm:gap-6 lg:gap-12 w-full min-w-0 mx-auto"
        :class="wide ? 'lg:max-w-5xl' : 'lg:max-w-2xl'"
      >
        <NuxtPage />
      </div>
    </template>
  </UDashboardPanel>
</template>
