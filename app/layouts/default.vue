<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const toast = useToast()
const auth = useAuth()

const open = ref(false)

/**
 * FEAT-008 — display-only role filter for the nav (the API is the authority; a Payment-only admin that
 * types the URL still gets the 403 state on the page). Items without a role rule are always visible.
 */
const isTemplateManager = computed(() => {
  const roles = auth.admin.value?.roles ?? []
  return roles.includes('GOD') || roles.includes('Admin')
})

/**
 * FEAT-021 — the Cashier group (Top-ups) is for GOD / Payment / Admin (spec D9, D17, D18). Same display-only
 * rule as above: the API is the authority and `/topups` renders `tp-forbidden` for anybody else.
 */
const canSeeCashier = computed(() => {
  const roles = auth.admin.value?.roles ?? []
  return roles.includes('GOD') || roles.includes('Payment') || roles.includes('Admin')
})

/**
 * FEAT-009 — same display-only filter for the GOD-only Admin Management item; `middleware/god-only.ts` and the
 * API's `@Roles('GOD')` are what actually protect the page. (BUG-026: dropped by the FEAT-009 merge, restored.)
 */
const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))

const links = computed(() => [[{
  label: 'Home',
  icon: 'i-lucide-house',
  to: '/',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Browser profiles',
  icon: 'i-lucide-app-window',
  to: '/browser-profiles',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'TikTok accounts',
  icon: 'i-lucide-user-round',
  to: '/tiktok-accounts',
  onSelect: () => {
    open.value = false
  }
}, ...(isTemplateManager.value
  ? [{
      // FEAT-008 — ad group templates (function 6.8), directly under TikTok accounts, above Proxies;
      // hidden when the admin has neither GOD nor Admin (Payment-only)
      label: 'Ad group templates',
      icon: 'i-lucide-layout-template',
      to: '/ad-group-templates',
      onSelect: () => {
        open.value = false
      }
    }, {
      // FEAT-012 — ad templates (function 6.9), directly under Ad group templates; same role gate
      label: 'Ad templates',
      icon: 'i-lucide-clapperboard',
      to: '/ad-templates',
      onSelect: () => {
        open.value = false
      }
    }, {
      // FEAT-016 — launch ads (functions 6.2–6.4), directly under Ad templates; same role gate
      label: 'Launch ads',
      icon: 'i-lucide-rocket',
      to: '/launch-ads',
      onSelect: () => {
        open.value = false
      }
    }, {
      // FEAT-016 — campaign orders report (functions 6.5, 6.6); no badge here (no polling in the layout, A7)
      label: 'Orders',
      icon: 'i-lucide-list-checks',
      to: '/orders',
      onSelect: () => {
        open.value = false
      }
    }, {
      // FEAT-020 — ads report (api-contract §6.1), directly after Orders; same role gate, no badge
      label: 'Reports',
      icon: 'i-lucide-chart-no-axes-combined',
      to: '/reports',
      onSelect: () => {
        open.value = false
      }
    }, {
      // FEAT-035 — report summary grouped by TikTok account / advertiser / ads, directly after Reports
      label: 'Report summary',
      icon: 'i-lucide-sigma',
      to: '/reports/summary',
      onSelect: () => {
        open.value = false
      }
    }]
  : []), ...(canSeeCashier.value
  ? [{
      // FEAT-021 — Cashier → Top-ups (AC-18); GOD / Payment / Admin, Admin read-only inside the page
      label: 'Cashier',
      icon: 'i-lucide-wallet',
      type: 'trigger' as const,
      defaultOpen: true,
      children: [{
        label: 'Top-ups',
        to: '/topups',
        onSelect: () => {
          open.value = false
        }
      }]
    }]
  : []), {
  // FEAT-006 — proxy list (function 2.9), directly under TikTok accounts; Settings stays last
  label: 'Proxies',
  icon: 'i-lucide-network',
  to: '/proxies',
  onSelect: () => {
    open.value = false
  }
}, ...(isGod.value
  ? [{
      // FEAT-009 — Admin Management (functions 0.2–0.5), after Proxies; Settings stays last
      label: 'Admin Management',
      icon: 'i-lucide-shield-check',
      to: '/admins',
      onSelect: () => {
        open.value = false
      }
    }, {
      // BUG-037 — Settings (only content is the GOD-only Auto top-up tab, FEAT-030), last item
      label: 'Settings',
      icon: 'i-lucide-settings',
      to: '/settings',
      onSelect: () => {
        open.value = false
      }
    }]
  : [])]] satisfies NavigationMenuItem[][])

// BUG-004 — the template's second group ("Code" → "View page source" on github.com/nuxt-ui-templates/dashboard)
// is removed: the search palette only offers this app's own routes, and nothing in the BO links to a third party.
const groups = computed(() => [{
  id: 'links',
  label: 'Go to',
  items: links.value.flat()
}])

/**
 * FEAT-009 — one-shot flash messages (`app/utils/flash.ts`). A middleware that redirects during the **server**
 * render leaves its message in the `bo-flash` cookie; it is shown once here and cleared. On the client the
 * middleware toasts directly, so nothing is left in the cookie there.
 * BUG-009: consumed on mount (direct URL load → SSR redirect → fresh page) and in `router.afterEach`, which —
 * unlike a `route.fullPath` watcher — also fires when a guard redirects back to the route the user is already on.
 */
function showFlash() {
  const flash = takeFlash()
  if (!flash) return
  toast.add({ title: flash.title, description: flash.description, color: flash.color ?? 'info' })
}

const stopFlashHook = useRouter().afterEach(() => showFlash())
onUnmounted(stopFlashHook)

onMounted(async () => {
  showFlash()

  const cookie = useCookie('cookie-consent')
  if (cookie.value === 'accepted') {
    return
  }

  toast.add({
    title: 'We use first-party cookies to enhance your experience on our website.',
    duration: 0,
    close: false,
    actions: [{
      label: 'Accept',
      color: 'neutral',
      variant: 'outline',
      onClick: () => {
        cookie.value = 'accepted'
      }
    }, {
      label: 'Opt out',
      color: 'neutral',
      variant: 'ghost'
    }]
  })
})
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #header="{ collapsed }">
        <TeamsMenu :collapsed="collapsed" />
      </template>

      <template #default="{ collapsed }">
        <UDashboardSearchButton :collapsed="collapsed" class="bg-transparent ring-default" />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          tooltip
          popover
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />

    <NotificationsSlideover />
  </UDashboardGroup>
</template>
