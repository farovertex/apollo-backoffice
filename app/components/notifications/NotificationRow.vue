<script setup lang="ts">
/**
 * FEAT-095 (spec "UI behaviour", AC-15; actor label A19) — one notification row in the slideover. Level icon
 * (colour by level), title, body, a meta line + relative time, and an unread dot. Read rows are dimmed. Click
 * or Enter/Space activates it (mark read + navigate), handled by the parent through `open`.
 *
 * Meta line (A19): GOD sees "โดย <displayName>" when `actor` ≠ null, else "ระบบ". A non-GOD viewer only ever
 * receives rows where the actor is themselves (requester rows) or nobody (system events) — never another
 * person's name — so the meta reads "คุณ" when `actor` ≠ null and "ระบบ" when it is null.
 */
import type { NotificationView } from '#shared/types/notifications'

const props = defineProps<{
  notification: NotificationView
  /** ticked clock from the parent so the relative time refreshes without a per-row timer */
  now?: Date
}>()

const emit = defineEmits<{ open: [notification: NotificationView] }>()

const auth = useAuth()
/** only GOD sees who triggered an event (AC-15); everyone else reads "คุณ"/"ระบบ" (A19) */
const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))

const n = computed(() => props.notification)
const unread = computed(() => n.value.readAt === null)
const time = computed(() => notificationTime(n.value.createdAt, props.now ?? new Date()))
const meta = computed(() => {
  if (!n.value.actor) return 'ระบบ'
  return isGod.value ? `โดย ${n.value.actor.displayName}` : 'คุณ'
})

function activate() {
  emit('open', n.value)
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="group relative -mx-2 flex gap-3 rounded-md px-2 py-2.5 text-start transition-colors hover:bg-elevated/50 focus:bg-elevated/50 focus:outline-none"
    :class="unread ? '' : 'opacity-60'"
    data-testid="nt-row"
    :data-id="n.id"
    :data-kind="n.kind"
    :data-level="n.level"
    :data-unread="unread ? '1' : '0'"
    @click="activate"
    @keydown.enter.prevent="activate"
    @keydown.space.prevent="activate"
  >
    <UIcon :name="levelIcon(n.level)" class="mt-0.5 size-5 shrink-0" :class="levelIconClass(n.level)" />

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <p class="min-w-0 flex-1 text-sm font-medium text-highlighted" data-testid="nt-row-title">
          {{ n.title }}
        </p>
        <span
          v-if="unread"
          class="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
          aria-label="ยังไม่อ่าน"
        />
      </div>

      <p v-if="n.body" class="mt-0.5 text-sm break-words text-muted" data-testid="nt-row-body">
        {{ n.body }}
      </p>

      <div class="mt-1 flex items-center gap-2 text-xs text-dimmed">
        <span data-testid="nt-row-meta">{{ meta }}</span>
        <span aria-hidden="true">·</span>
        <time :datetime="n.createdAt" data-testid="nt-row-time">{{ time }}</time>
      </div>
    </div>
  </div>
</template>
