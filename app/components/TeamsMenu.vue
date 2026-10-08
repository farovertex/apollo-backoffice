<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

defineProps<{
  collapsed?: boolean
}>()

/**
 * BUG-004 — the dashboard template shipped these entries with `avatar.src` pointing at
 * `https://github.com/<org>.png`, so every authenticated page made third-party image requests (and the sidebar
 * broke without internet). The avatars are **initials only** now (`UAvatar` `text`, rendered locally): no `src`
 * anywhere in this component, no request leaves the BO origin. Structure and behaviour are unchanged.
 */
const teams = ref([{
  label: 'Nuxt',
  avatar: {
    text: 'NX',
    alt: 'Nuxt'
  }
}, {
  label: 'NuxtHub',
  avatar: {
    text: 'NH',
    alt: 'NuxtHub'
  }
}, {
  label: 'NuxtLabs',
  avatar: {
    text: 'NL',
    alt: 'NuxtLabs'
  }
}])
const selectedTeam = ref(teams.value[0])

const items = computed<DropdownMenuItem[][]>(() => {
  return [teams.value.map(team => ({
    ...team,
    onSelect() {
      selectedTeam.value = team
    }
  })), [{
    label: 'Create team',
    icon: 'i-lucide-circle-plus'
  }, {
    label: 'Manage teams',
    icon: 'i-lucide-cog'
  }]]
})
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{ content: collapsed ? 'w-40' : 'w-(--reka-dropdown-menu-trigger-width)' }"
  >
    <UButton
      v-bind="{
        ...selectedTeam,
        label: collapsed ? undefined : selectedTeam?.label,
        trailingIcon: collapsed ? undefined : 'i-lucide-chevrons-up-down'
      }"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :class="[!collapsed && 'py-2']"
      :ui="{
        trailingIcon: 'text-dimmed'
      }"
    />
  </UDropdownMenu>
</template>
