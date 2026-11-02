<script setup lang="ts">
import type { VNode } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{
  collapsed?: boolean
}>()

const colorMode = useColorMode()
const appConfig = useAppConfig()
const auth = useAuth()

// FEAT-095 — the two notification switches also live here, after Appearance, bound to the shared composable
const { prefs, setPref } = useNotifications()

/**
 * Nuxt UI 4 forwards only `class` / `ui` from an item object to the DOM, so a `data-testid` written on the item
 * would land nowhere. The `item-label` slot stamps it onto the rendered menu item element (`[data-slot="item"]`).
 */
function stampMenuItem(testid: string) {
  return (vnode: VNode) => {
    const el = vnode.el as HTMLElement | null
    const target = el?.closest('[data-slot="item"]') ?? el
    target?.setAttribute('data-testid', testid)
  }
}

// TASK-theme-cbo-cap — one list with `plugins/theme-colors.client.ts`, which remembers the choice in `localStorage`
const colors = THEME_PRIMARY_COLORS
const neutrals = THEME_NEUTRAL_COLORS

const displayName = computed(() => auth.admin.value?.displayName || auth.admin.value?.username || 'Account')
const roles = computed(() => auth.admin.value?.roles ?? [])
// no avatar image in the API → UAvatar renders initials from `alt`
const avatar = computed(() => ({ alt: displayName.value }))

async function onLogout() {
  await auth.logout()
  await navigateTo('/login', { replace: true })
}

type UserMenuItem = DropdownMenuItem & { testid?: string }

const items = computed<UserMenuItem[][]>(() => ([[{
  type: 'label',
  label: displayName.value,
  avatar: avatar.value
}, {
  type: 'label',
  label: roles.value.length ? roles.value.join(' · ') : 'no role',
  icon: 'i-lucide-shield-check',
  class: 'font-normal text-muted'
}], [{
  label: 'Theme',
  icon: 'i-lucide-palette',
  children: [{
    label: 'Primary',
    slot: 'chip',
    chip: appConfig.ui.colors.primary,
    content: {
      align: 'center',
      collisionPadding: 16
    },
    children: colors.map(color => ({
      label: color,
      chip: color,
      slot: 'chip',
      checked: appConfig.ui.colors.primary === color,
      type: 'checkbox',
      onSelect: (e) => {
        e.preventDefault()

        appConfig.ui.colors.primary = color
      }
    }))
  }, {
    label: 'Neutral',
    slot: 'chip',
    chip: appConfig.ui.colors.neutral === 'neutral' ? 'old-neutral' : appConfig.ui.colors.neutral,
    content: {
      align: 'end',
      collisionPadding: 16
    },
    children: neutrals.map(color => ({
      label: color,
      chip: color === 'neutral' ? 'old-neutral' : color,
      slot: 'chip',
      type: 'checkbox',
      checked: appConfig.ui.colors.neutral === color,
      onSelect: (e) => {
        e.preventDefault()

        appConfig.ui.colors.neutral = color
      }
    }))
  }]
}, {
  label: 'Appearance',
  icon: 'i-lucide-sun-moon',
  children: [{
    label: 'Light',
    icon: 'i-lucide-sun',
    type: 'checkbox',
    checked: colorMode.value === 'light',
    onSelect(e: Event) {
      e.preventDefault()

      colorMode.preference = 'light'
    }
  }, {
    label: 'Dark',
    icon: 'i-lucide-moon',
    type: 'checkbox',
    checked: colorMode.value === 'dark',
    onUpdateChecked(checked: boolean) {
      if (checked) {
        colorMode.preference = 'dark'
      }
    },
    onSelect(e: Event) {
      e.preventDefault()
    }
  }]
}, {
  // FEAT-095 — notification toast switch, after Appearance (same optimistic composable the slideover gear uses)
  label: 'เด้ง toast แจ้งเตือน',
  icon: 'i-lucide-bell',
  type: 'checkbox',
  checked: prefs.notifyToast,
  testid: 'um-notify-toast',
  onUpdateChecked(checked: boolean) {
    void setPref('notifyToast', checked)
  },
  onSelect(e: Event) {
    e.preventDefault()
  }
}, {
  // FEAT-095 — notification sound switch
  label: 'เสียงแจ้งเตือน',
  icon: 'i-lucide-volume-2',
  type: 'checkbox',
  checked: prefs.notifySound,
  testid: 'um-notify-sound',
  onUpdateChecked(checked: boolean) {
    void setPref('notifySound', checked)
  },
  onSelect(e: Event) {
    e.preventDefault()
  }
}], [{
  label: 'Log out',
  icon: 'i-lucide-log-out',
  onSelect: onLogout
}]]))

/** stamp the two notification items' test ids onto the rendered menu element (item objects don't carry attrs) */
function onItemLabelMounted(vnode: VNode, item: UserMenuItem) {
  if (!item.testid) return
  stampMenuItem(item.testid)(vnode)
}
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      v-bind="{
        avatar,
        label: collapsed ? undefined : displayName,
        trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
      }"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{
        trailingIcon: 'text-dimmed'
      }"
      data-testid="user-menu"
    />

    <template #item-label="{ item }">
      <span @vue:mounted="(vnode: VNode) => onItemLabelMounted(vnode, item as UserMenuItem)">{{ item.label }}</span>
    </template>

    <template #chip-leading="{ item }">
      <div class="inline-flex items-center justify-center shrink-0 size-5">
        <span
          class="rounded-full ring ring-bg bg-(--chip-light) dark:bg-(--chip-dark) size-2"
          :style="{
            '--chip-light': `var(--color-${(item as any).chip}-500)`,
            '--chip-dark': `var(--color-${(item as any).chip}-400)`
          }"
        />
      </div>
    </template>
  </UDropdownMenu>
</template>
