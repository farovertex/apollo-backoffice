<script setup lang="ts">
/**
 * FEAT-095 (spec "UI behaviour", AC-14) — the sidebar bell, above the search button. Icon + label
 * "การแจ้งเตือน" (label hidden when the sidebar is collapsed), an unread badge (`99+` above 99, hidden at 0)
 * and a small dot for the stream state (green live · grey poll/off). Click toggles the slideover; the `n`
 * shortcut does the same (owned by `useDashboard`).
 */
defineProps<{ collapsed?: boolean }>()

const { unreadCount, streamState } = useNotifications()
const { isNotificationsSlideoverOpen } = useDashboard()

const badgeText = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)))
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    block
    :square="collapsed"
    :class="collapsed ? 'relative' : 'justify-start'"
    data-testid="nt-bell"
    :data-count="unreadCount"
    :data-nt-stream="streamState"
    :aria-label="`การแจ้งเตือน${unreadCount ? ` · ${unreadCount} ยังไม่อ่าน` : ''}`"
    @click="isNotificationsSlideoverOpen = !isNotificationsSlideoverOpen"
  >
    <UIcon name="i-lucide-bell" class="size-5 shrink-0" />
    <span v-if="!collapsed" class="truncate">การแจ้งเตือน</span>

    <!-- collapsed: the badge overlays the icon (icon + badge only, AC-14) -->
    <UBadge
      v-if="collapsed && unreadCount > 0"
      color="error"
      variant="solid"
      size="sm"
      class="absolute -end-1 -top-1 tabular-nums"
      data-testid="nt-badge"
    >
      {{ badgeText }}
    </UBadge>

    <template v-if="!collapsed" #trailing>
      <span class="ms-auto inline-flex items-center gap-1.5">
        <UBadge
          v-if="unreadCount > 0"
          color="error"
          variant="solid"
          size="sm"
          class="tabular-nums"
          data-testid="nt-badge"
        >
          {{ badgeText }}
        </UBadge>
        <span
          class="size-1.5 shrink-0 rounded-full"
          :class="streamState === 'live' ? 'bg-success' : 'bg-muted'"
          :title="streamState === 'live' ? 'เรียลไทม์' : 'กำลังเชื่อมต่อใหม่'"
        />
      </span>
    </template>
  </UButton>
</template>
