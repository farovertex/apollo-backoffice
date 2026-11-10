<script setup lang="ts">
/**
 * FEAT-099 (spec "UI behaviour → Account card", AC-14, AC-28, AC-29) — one linked mssg account.
 *
 * Shows nickname · email, the status badge, "N เว็บ · ดึงล่าสุด …", plan, quota, the last error and the site rows.
 * Controls (refresh / เข้าสู่ระบบใหม่ / rename / ยกเลิกการเชื่อม) only emit — the page makes every request. The four
 * future buttons are rendered **disabled** with a "เร็ว ๆ นี้" hint and have no handler, so they can never send a
 * request. `readonly` (the GOD overview) renders no control at all, not even the disabled ones.
 * v2: while `disconnecting` (unlink requested, logout job not finished) the card shows "กำลังออกจากระบบ…" and every
 * control is disabled; the page removes it when the account answers 404.
 * Test ids inside the card are fixed (`mp-status`, `mp-plan`, …) — QA scopes them by `mp-card-<id>`.
 */
import type { MssgAccountView } from '#shared/types/mssg-accounts'

const props = withDefaults(defineProps<{
  account: MssgAccountView
  /** GOD overview: no control of any kind */
  readonly?: boolean
  /** a request of this card is in flight (sync POST) */
  requesting?: boolean
  /** the page-level "ดึงข้อมูลใหม่" is still waiting for its jobs */
  pageSyncing?: boolean
  /** the 15 min follow-up of this account's job gave up */
  pollTimedOut?: boolean
}>(), { readonly: false, requesting: false, pageSyncing: false, pollTimedOut: false })

const emit = defineEmits<{
  refresh: []
  relogin: []
  rename: []
  unlink: []
  reload: []
}>()

const a = computed(() => props.account)
const busy = computed(() => mssgNeedsPoll(a.value))
const disconnecting = computed(() => a.value.status === 'disconnecting')
const unlinkBlocked = computed(() => disconnecting.value || a.value.job?.status === 'active')
const progressLabel = computed(() => {
  if (disconnecting.value || a.value.job?.type === 'mssgLogout') return 'กำลังออกจากระบบ…'
  return `${a.value.job?.type === 'mssgSync' ? 'กำลังดึง' : 'กำลังเข้าสู่ระบบ'} · ${mssgJobProgressText(a.value.job)}`
})
const canRelogin = computed(() => a.value.status === 'expired' || a.value.status === 'error')
const refreshDisabled = computed(() => a.value.status !== 'connected' || busy.value || props.requesting || props.pageSyncing)
const refreshHint = computed(() => {
  if (busy.value) return disconnecting.value ? 'กำลังออกจากระบบ…' : mssgJobProgressText(a.value.job)
  if (a.value.status !== 'connected') return 'ดึงใหม่ได้เมื่อบัญชีเชื่อมแล้วเท่านั้น'
  return 'ดึงใหม่เฉพาะบัญชีนี้'
})
const lastSyncText = computed(() => (a.value.lastSyncAt ? formatDateTime(a.value.lastSyncAt) : 'ยังไม่เคยดึง'))
const quotaFull = computed(() => mssgQuotaFull(a.value.quota))
</script>

<template>
  <article
    :data-testid="`mp-card-${a.id}`"
    :data-status="a.status"
    :data-job-status="a.job?.status ?? ''"
    :data-job-type="a.job?.type ?? ''"
    :data-busy="busy ? 'true' : 'false'"
    :aria-busy="disconnecting ? 'true' : undefined"
    class="flex min-w-0 flex-col overflow-hidden rounded-lg border border-default bg-elevated/40"
  >
    <div class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2">
      <div class="flex min-w-0 flex-1 basis-48 flex-col gap-1">
        <p class="text-sm break-words">
          <span class="font-semibold text-highlighted" data-testid="mp-card-name">{{ a.nickname || 'บัญชี mssg' }}</span>
          <span class="text-muted"> · </span>
          <span class="break-all text-muted" data-testid="mp-card-email">{{ a.email }}</span>
        </p>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <UBadge
            :label="mssgStatusText(a.status)"
            :color="mssgStatusColor(a.status)"
            variant="subtle"
            size="sm"
            data-testid="mp-status"
            :data-status="a.status"
          />
          <span data-testid="mp-card-meta">{{ a.sites.length }} เว็บ · ดึงล่าสุด {{ lastSyncText }}</span>
        </div>
      </div>

      <div v-if="!readonly" class="flex flex-wrap items-center gap-1.5">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="requesting"
          :disabled="refreshDisabled"
          :aria-label="refreshHint"
          :title="refreshHint"
          data-testid="mp-refresh"
          @click="emit('refresh')"
        />
        <UButton
          v-if="canRelogin"
          label="เข้าสู่ระบบใหม่"
          icon="i-lucide-log-in"
          color="primary"
          variant="soft"
          size="sm"
          :disabled="busy"
          data-testid="mp-relogin"
          @click="emit('relogin')"
        />
        <UButton
          icon="i-lucide-pencil"
          color="neutral"
          variant="outline"
          size="sm"
          aria-label="ตั้งชื่อเรียกบัญชี"
          title="ตั้งชื่อเรียกบัญชี"
          :disabled="disconnecting"
          data-testid="mp-rename"
          @click="emit('rename')"
        />
        <UButton
          label="ยกเลิกการเชื่อม"
          color="error"
          variant="outline"
          size="sm"
          :disabled="unlinkBlocked"
          :title="unlinkBlocked ? (disconnecting ? 'กำลังออกจากระบบ…' : 'รอให้งานที่กำลังทำเสร็จก่อน') : undefined"
          data-testid="mp-unlink"
          @click="emit('unlink')"
        />
      </div>
    </div>

    <div
      v-if="busy"
      class="flex items-center gap-2 border-b border-default px-3 py-2 text-xs text-warning"
      role="status"
      data-testid="mp-card-progress"
      :data-step="a.job?.step ?? ''"
    >
      <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
      <span class="min-w-0 break-words">{{ progressLabel }}</span>
    </div>

    <div
      v-if="pollTimedOut"
      class="flex flex-wrap items-center gap-2 border-b border-default px-3 py-2 text-xs text-warning"
      role="status"
      data-testid="mp-poll-timeout"
    >
      <span class="min-w-0 flex-1">{{ MSSG_POLL_TIMEOUT_TEXT }}</span>
      <UButton
        label="รีเฟรช"
        icon="i-lucide-rotate-cw"
        color="warning"
        variant="outline"
        size="xs"
        data-testid="mp-poll-reload"
        @click="emit('reload')"
      />
    </div>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-default px-3 py-2">
      <UBadge
        :label="a.plan?.name ?? 'ไม่ทราบแพ็กเกจ'"
        :color="mssgIsPro(a.plan) ? 'primary' : 'neutral'"
        variant="subtle"
        size="sm"
        class="font-semibold"
        data-testid="mp-plan"
        :data-plan="a.plan?.name ?? ''"
      />
      <div
        class="flex min-w-28 flex-1 basis-32 flex-col gap-1"
        data-testid="mp-quota"
        :data-used="a.quota?.used ?? ''"
        :data-limit="a.quota ? (a.quota.limit ?? 'null') : ''"
      >
        <span class="text-xs text-toned">เว็บ {{ mssgQuotaText(a.quota) }}</span>
        <UProgress
          v-if="a.quota && a.quota.limit"
          :model-value="mssgQuotaPct(a.quota)"
          :color="quotaFull ? 'warning' : 'primary'"
          size="xs"
          aria-hidden="true"
        />
      </div>
      <template v-if="!readonly">
        <UButton
          label="+ สร้างเว็บ"
          color="neutral"
          variant="outline"
          size="xs"
          disabled
          :title="MSSG_SOON"
          data-testid="mp-create-site"
        >
          <template #trailing>
            <span class="text-[10px] text-dimmed">{{ MSSG_SOON }}</span>
          </template>
        </UButton>
        <UButton
          v-if="!mssgIsPro(a.plan)"
          label="อัปเกรดเป็น Pro"
          color="warning"
          variant="outline"
          size="xs"
          disabled
          :title="MSSG_SOON"
          data-testid="mp-upgrade"
        >
          <template #trailing>
            <span class="text-[10px] text-dimmed">{{ MSSG_SOON }}</span>
          </template>
        </UButton>
      </template>
    </div>

    <div
      v-if="a.lastError"
      class="flex flex-col gap-0.5 border-b border-default px-3 py-2 text-xs"
      role="alert"
      data-testid="mp-card-error"
      :data-code="a.lastError.code"
    >
      <span class="break-words text-error">{{ mssgErrorText(a.lastError.code) }}</span>
      <span v-if="a.lastError.message" class="break-words text-dimmed" data-testid="mp-card-error-detail">{{ a.lastError.message }}</span>
    </div>

    <ul v-if="a.sites.length" class="flex flex-col">
      <li
        v-for="(site, i) in a.sites"
        :key="`${i}-${site.url}`"
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-default px-3 py-2 last:border-b-0"
        data-testid="mp-site"
        :data-index="i"
        :data-url="site.url"
        :data-status="site.status"
      >
        <span class="flex min-w-0 flex-1 basis-40 flex-col">
          <span class="text-sm break-words text-highlighted" data-testid="mp-site-name">{{ site.name }}</span>
          <span class="truncate text-xs text-muted" :title="site.url" data-testid="mp-site-url">{{ site.url }}</span>
        </span>
        <span
          class="text-xs"
          :class="site.status === 'published' ? 'text-success' : 'text-muted'"
          data-testid="mp-site-status"
        >{{ mssgSiteStatusText(site.status) }}</span>
        <div v-if="!readonly" class="flex items-center gap-1.5">
          <UButton
            label="Analytics"
            color="neutral"
            variant="outline"
            size="xs"
            disabled
            :title="MSSG_SOON"
            data-testid="mp-site-analytics"
          />
          <UButton
            label="แก้ไขเว็บ"
            color="neutral"
            variant="outline"
            size="xs"
            disabled
            :title="MSSG_SOON"
            data-testid="mp-site-edit"
          />
          <span class="text-[10px] text-dimmed">{{ MSSG_SOON }}</span>
        </div>
      </li>
    </ul>
    <p v-else class="px-3 py-3 text-center text-xs text-muted" data-testid="mp-sites-empty">
      ยังไม่มีเว็บที่ดึงมาจากบัญชีนี้
    </p>
  </article>
</template>
