<script setup lang="ts">
/**
 * TASK-campaign-delete-ui — `am-delete`: the campaign tab's last column ("ลบ"). Four mutually exclusive
 * renderings, driven only by what the API sent (the BO never re-derives the rule, same as `switchable`):
 *
 * 1. **deleted** (`deletedAt` set): just `—`; the campaign is already gone on TikTok, the row is kept.
 * 2. **pending** (`deletePending`, from the API or from our own accepted 202): spinner + "กำลังลบ…"
 *    (`am-delete-pending-<id>`). Reload-safe — a row that arrives with `deletePending` looks the same.
 * 3. **error** (`deleteError`, no pending): red "ลบไม่สำเร็จ: <reason>" + a retry icon
 *    (`am-delete-retry-<id>`) that reopens the confirm modal.
 * 4. **idle**: the trash button `am-delete-<id>`, enabled when `deletable.ok`, otherwise disabled with
 *    `deletable.reason` as tooltip **and** `title` (the API's Thai sentence).
 *
 * `data-state` ( deleted · pending · error · ok · blocked ) is the one attribute QA needs to assert on.
 */
import type { MonitorRow } from '#shared/types/ads-monitor'

const props = defineProps<{ row: MonitorRow }>()
const emit = defineEmits<{ ask: [] }>()

const deleted = computed(() => typeof props.row.deletedAt === 'string' && props.row.deletedAt !== '')
const pending = computed(() => (deleted.value ? null : props.row.deletePending ?? null))
const failure = computed(() => (deleted.value || pending.value ? null : props.row.deleteError ?? null))
/** a row without `deletable` (an older API, or a non-campaign level) can never be deleted from here */
const deletable = computed(() => props.row.deletable ?? { ok: false, reason: null })
const blockedReason = computed(() => (deletable.value.ok ? null : deletable.value.reason))

const state = computed(() => {
  if (deleted.value) return 'deleted'
  if (pending.value) return 'pending'
  if (failure.value) return 'error'
  return deletable.value.ok ? 'ok' : 'blocked'
})

const ariaLabel = computed(() => `ลบแคมเปญ ${props.row.name ?? props.row.id}`)
</script>

<template>
  <div
    class="flex min-w-0 flex-col items-start gap-1"
    data-testid="am-delete"
    :data-id="row.id"
    :data-state="state"
  >
    <template v-if="deleted">
      {{ REPORT_DASH }}
    </template>

    <span
      v-else-if="pending"
      class="flex items-center gap-1 text-xs whitespace-nowrap text-muted"
      :data-testid="`am-delete-pending-${row.id}`"
    >
      <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
      กำลังลบ…
    </span>

    <template v-else-if="failure">
      <span
        class="w-44 text-xs leading-tight text-error"
        :data-testid="`am-delete-error-${row.id}`"
      >ลบไม่สำเร็จ: {{ failure.reason }}</span>
      <UButton
        icon="i-lucide-rotate-ccw"
        color="error"
        variant="subtle"
        size="xs"
        aria-label="ลองลบอีกครั้ง"
        title="กดเพื่อลองใหม่"
        :data-testid="`am-delete-retry-${row.id}`"
        @click="emit('ask')"
      />
    </template>

    <UTooltip v-else :text="blockedReason ?? ''" :disabled="!blockedReason">
      <span class="inline-flex" :title="blockedReason ?? undefined">
        <UButton
          icon="i-lucide-trash-2"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="ariaLabel"
          :disabled="!deletable.ok"
          :data-testid="`am-delete-${row.id}`"
          @click="emit('ask')"
        />
      </span>
    </UTooltip>
  </div>
</template>
