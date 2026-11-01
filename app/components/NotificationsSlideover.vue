<script setup lang="ts">
/**
 * FEAT-095 (spec "UI behaviour", AC-15/AC-19) — the admin notifications slideover, mounted once by the layout.
 * Header (count · sound toggle · settings gear · close), tabs (ยังไม่อ่าน default / ทั้งหมด), "อ่านทั้งหมดแล้ว",
 * rows grouped by day, "โหลดเพิ่ม" cursor pagination, loading / empty / error states. A row click (or Enter/Space)
 * marks it read, navigates and closes the slideover — the close on navigation is the template behaviour kept by
 * `useDashboard` (watch of `route.fullPath`).
 */
import type { SlideoverProps } from '@nuxt/ui'
// explicit: the file is NotificationRow.vue (contract §6) but its auto-import name would be NotificationsNotificationRow
import NotificationRow from './notifications/NotificationRow.vue'

const { isNotificationsSlideoverOpen } = useDashboard()
const {
  items,
  unreadCount,
  nextCursor,
  tab,
  prefs,
  loadingFirst,
  loadingMore,
  loadError,
  setTab,
  loadMore,
  markAllRead,
  setPref,
  openLink,
  loadFirst
} = useNotifications()

const now = useNow({ interval: 30_000 })
const groups = computed(() => groupByDay(items.value, now.value))
const isEmpty = computed(() => !loadingFirst.value && !loadError.value && items.value.length === 0)

const slideoverContent = computed(() => ({ 'data-testid': 'nt-slideover' }) as SlideoverProps['content'])
const settingsOpen = ref(false)
</script>

<template>
  <USlideover
    v-model:open="isNotificationsSlideoverOpen"
    :content="slideoverContent"
    :ui="{ body: 'p-0 sm:p-0', header: 'block' }"
  >
    <template #header>
      <div class="flex w-full flex-col gap-3">
        <div class="flex items-center gap-2">
          <h2 class="flex-1 text-sm font-semibold text-highlighted">
            การแจ้งเตือน
            <span class="text-muted" data-testid="nt-count"> · {{ unreadCount }} ยังไม่อ่าน</span>
          </h2>

          <UButton
            :icon="prefs.notifySound ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-pressed="prefs.notifySound"
            :aria-label="prefs.notifySound ? 'ปิดเสียงแจ้งเตือน' : 'เปิดเสียงแจ้งเตือน'"
            :disabled="!prefs.loaded"
            data-testid="nt-sound-toggle"
            @click="setPref('notifySound', !prefs.notifySound)"
          />

          <UPopover v-model:open="settingsOpen">
            <UButton
              icon="i-lucide-settings"
              color="neutral"
              variant="ghost"
              size="sm"
              aria-label="ตั้งค่าการแจ้งเตือน"
              data-testid="nt-settings-toggle"
            />
            <template #content>
              <NotificationsSettings />
            </template>
          </UPopover>

          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="ปิด"
            @click="isNotificationsSlideoverOpen = false"
          />
        </div>

        <div class="flex items-center gap-2">
          <UButton
            label="ยังไม่อ่าน"
            size="sm"
            :color="tab === 'unread' ? 'primary' : 'neutral'"
            :variant="tab === 'unread' ? 'solid' : 'outline'"
            :aria-pressed="tab === 'unread'"
            data-testid="nt-tab-unread"
            @click="setTab('unread')"
          />
          <UButton
            label="ทั้งหมด"
            size="sm"
            :color="tab === 'all' ? 'primary' : 'neutral'"
            :variant="tab === 'all' ? 'solid' : 'outline'"
            :aria-pressed="tab === 'all'"
            data-testid="nt-tab-all"
            @click="setTab('all')"
          />
          <UButton
            label="อ่านทั้งหมดแล้ว"
            size="sm"
            color="neutral"
            variant="ghost"
            class="ms-auto"
            :disabled="unreadCount === 0"
            data-testid="nt-read-all"
            @click="markAllRead"
          />
        </div>
      </div>
    </template>

    <template #body>
      <div class="flex flex-col px-4 py-3">
        <!-- loading -->
        <div v-if="loadingFirst && items.length === 0" class="flex flex-col gap-3" data-testid="nt-loading">
          <USkeleton v-for="i in 5" :key="i" class="h-14 w-full" />
        </div>

        <!-- error -->
        <div v-else-if="loadError" class="flex flex-col items-center gap-3 py-10 text-center" data-testid="nt-error">
          <UIcon name="i-lucide-triangle-alert" class="size-8 text-error" />
          <p class="text-sm text-muted">
            {{ loadError }}
          </p>
          <UButton
            label="ลองใหม่"
            color="neutral"
            variant="outline"
            size="sm"
            data-testid="nt-retry"
            @click="loadFirst"
          />
        </div>

        <!-- empty -->
        <div v-else-if="isEmpty" class="flex flex-col items-center gap-2 py-12 text-center" data-testid="nt-empty">
          <UIcon name="i-lucide-bell-off" class="size-8 text-dimmed" />
          <p class="text-sm text-muted">
            {{ tab === 'unread' ? 'ไม่มีแจ้งเตือนที่ยังไม่อ่าน' : 'ไม่มีแจ้งเตือน' }}
          </p>
        </div>

        <!-- rows -->
        <template v-else>
          <div v-for="group in groups" :key="group.label" class="mb-2">
            <p class="sticky top-0 z-10 bg-default/80 py-1 text-xs font-medium text-dimmed backdrop-blur" data-testid="nt-day">
              {{ group.label }}
            </p>
            <NotificationRow
              v-for="n in group.items"
              :key="n.id"
              :notification="n"
              :now="now"
              @open="openLink"
            />
          </div>

          <UButton
            v-if="nextCursor"
            label="โหลดเพิ่ม"
            color="neutral"
            variant="outline"
            size="sm"
            block
            class="mt-2"
            :loading="loadingMore"
            data-testid="nt-more"
            @click="loadMore"
          />
        </template>
      </div>
    </template>
  </USlideover>
</template>
