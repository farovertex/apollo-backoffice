<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const route = useRoute()
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
 * FEAT-009 — same display-only filter for the GOD-only Admin Management item; `middleware/god-only.ts` and the
 * API's `@Roles('GOD')` are what actually protect the page.
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
  label: 'Inbox',
  icon: 'i-lucide-inbox',
  to: '/inbox',
  badge: '4',
  onSelect: () => {
    open.value = false
  }
}, {
  label: 'Customers',
  icon: 'i-lucide-users',
  to: '/customers',
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
      // FEAT-009 — Admin Management (functions 0.2–0.5), after Proxies; GOD only, Settings stays last
      label: 'Admin Management',
      icon: 'i-lucide-shield-check',
      to: '/admins',
      onSelect: () => {
        open.value = false
      }
    }]
  : []), {
  label: 'Settings',
  to: '/settings',
  icon: 'i-lucide-settings',
  defaultOpen: true,
  type: 'trigger',
  children: [{
    label: 'General',
    to: '/settings',
    exact: true,
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Members',
    to: '/settings/members',
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Notifications',
    to: '/settings/notifications',
    onSelect: () => {
      open.value = false
    }
  }, {
    label: 'Security',
    to: '/settings/security',
    onSelect: () => {
      open.value = false
    }
  }]
}], [{
  label: 'Feedback',
  icon: 'i-lucide-message-circle',
  to: 'https://github.com/nuxt-ui-templates/dashboard',
  target: '_blank'
}, {
  label: 'Help & Support',
  icon: 'i-lucide-info',
  to: 'https://github.com/nuxt-ui-templates/dashboard',
  target: '_blank'
}]] satisfies NavigationMenuItem[][])

const groups = computed(() => [{
  id: 'links',
  label: 'Go to',
  items: links.value.flat()
}, {
  id: 'code',
  label: 'Code',
  items: [{
    id: 'source',
    label: 'View page source',
    icon: 'i-simple-icons-github',
    to: `https://github.com/nuxt-ui-templates/dashboard/blob/main/app/pages${route.path === '/' ? '/index' : route.path}.vue`,
    target: '_blank'
  }]
}])

/**
 * FEAT-009 — one-shot flash messages (`app/utils/flash.ts`). A middleware that redirects can leave a message in
 * the `bo-flash` cookie; it is shown once here and cleared. Checked on mount (direct URL load → SSR redirect →
 * fresh page) and after every navigation (client-side redirect → this layout is already mounted).
 */
function showFlash() {
  const flash = takeFlash()
  if (!flash) return
  toast.add({ title: flash.title, description: flash.description, color: flash.color ?? 'info' })
}

watch(() => route.fullPath, () => showFlash())

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

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[1]"
          orientation="vertical"
          tooltip
          class="mt-auto"
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
