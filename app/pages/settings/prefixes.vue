<script setup lang="ts">
/**
 * FEAT-076 — `/settings/prefixes` (spec "UI behaviour", api-contract §2 / §3 / §7).
 *
 * A prefix is a row of the `prefixes` collection (code, name, managing admins, status, Telegram slot) instead of a
 * string in `system_settings.utm.prefixes`. **GOD** manages every row (`st-prefixes-add` / `st-prefix-edit` →
 * `PrefixesFormModal`); an **Admin** reads the rows they manage (`st-prefixes-readonly`, no buttons). Guard:
 * `prefixes-access` (GOD/Admin pass, anybody else → "Not allowed" toast + home); the API (`@Roles`, the
 * `canManagePrefix` filter) is the authority for both the list and every write.
 *
 * Exactly one `GET /backend/prefixes?status=all` per mount / Retry / after every successful write (`retry: 0`),
 * rows in the API order (createdAt asc). The table is the only wide thing here; it scrolls inside its card on
 * narrow viewports.
 *
 * FEAT-077 (spec "UI behaviour", AC-16/AC-17, api-contract §4/§5/§10) — the Telegram column is live: one
 * `GET /backend/telegram/status` per mount / Retry decides whether the feature is usable (`enabled && configured`);
 * when it is not, `st-prefixes-tg-off` says why and the column shows only its text states. Otherwise each row
 * (`st-prefix-telegram[data-tg]` = `none` | `linked` | `failed`) gets `ผูกกลุ่ม` (`st-prefix-tg-link`) /
 * `ผูกใหม่` (`st-prefix-tg-relink`) → `PrefixesTelegramLinkModal`, and `ถอด` (`st-prefix-tg-unlink`) → confirm
 * (`st-prefix-tg-unlink-confirm`) → `DELETE /prefixes/:id/telegram` → row patched + toast + list re-read. GOD and the
 * managing Admin both see the buttons; the API (`canManagePrefix`) is the authority and its 404/409 text is toasted.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PrefixDetailView, PrefixView, PrefixesResponse } from '#shared/types/prefixes'
import type { TelegramStatus } from '#shared/types/telegram'

definePageMeta({ middleware: 'prefixes-access' })

useSeoMeta({ title: 'Prefixes' })

const LOAD_FALLBACK = 'โหลดรายการ Prefix ไม่สำเร็จ'

const api = useApi()
const toast = useToast()
const { admin } = useAuth()
const isGod = computed(() => admin.value?.roles.includes('GOD') === true)

type PageState = 'loading' | 'ready' | 'error'

const list = ref<PrefixView[] | null>(null)
const pending = ref(true)
const loadError = ref<string | null>(null)

const pageState = computed<PageState>(() => {
  if (loadError.value) return 'error'
  if (list.value === null) return 'loading'
  return 'ready'
})
const prefixes = computed<PrefixView[]>(() => list.value ?? [])

// bumped on every request so a late answer of a superseded GET is dropped
let session = 0

async function load() {
  const s = ++session
  pending.value = true
  loadError.value = null
  try {
    const res = await api<PrefixesResponse>('/prefixes', { query: { status: 'all' }, retry: 0 })
    if (s !== session) return
    list.value = res.prefixes ?? []
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    list.value = null
    loadError.value = err.data?.error ?? err.message ?? LOAD_FALLBACK
  } finally {
    if (s === session) pending.value = false
  }
}

// ── FEAT-077 · Telegram status (once per mount / Retry) ─────────────────────────────────────────────────────────────
const TG_DISABLED = 'Telegram ปิดอยู่ — GOD เปิดได้ที่ Settings → Telegram'
const TG_NOT_CONFIGURED = 'Telegram ปิดอยู่ — ยังไม่ได้ตั้ง token ที่เซิร์ฟเวอร์'
const TG_STATUS_FALLBACK = 'โหลดสถานะ Telegram ไม่สำเร็จ'

const tgStatus = ref<TelegramStatus | null>(null)
const tgError = ref<string | null>(null)
let tgSession = 0

async function loadTelegramStatus() {
  const s = ++tgSession
  tgError.value = null
  try {
    const res = await api<TelegramStatus>('/telegram/status', { retry: 0 })
    if (s !== tgSession) return
    tgStatus.value = res
  } catch (e) {
    if (s !== tgSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    tgStatus.value = null
    tgError.value = err.data?.error ?? err.message ?? TG_STATUS_FALLBACK
  }
}

/** link / relink / unlink buttons exist only while the feature can actually send */
const tgOn = computed(() => tgStatus.value?.enabled === true && tgStatus.value.configured === true)
/** `st-prefixes-tg-off`: why the column has no buttons (null while the status is loading, or when it is on) */
const tgOff = computed<{ reason: 'disabled' | 'notConfigured' | 'error', text: string } | null>(() => {
  if (tgError.value) return { reason: 'error', text: tgError.value }
  const st = tgStatus.value
  if (!st) return null
  if (!st.enabled) return { reason: 'disabled', text: TG_DISABLED }
  if (!st.configured) return { reason: 'notConfigured', text: TG_NOT_CONFIGURED }
  return null
})

type TgState = 'none' | 'linked' | 'failed'
function tgState(prefix: PrefixView): TgState {
  if (!prefix.telegram?.linked) return 'none'
  return prefix.telegram.failedAt ? 'failed' : 'linked'
}

function retry() {
  void load()
  void loadTelegramStatus()
}

onMounted(() => {
  void load()
  void loadTelegramStatus()
})
onUnmounted(() => {
  session++
  tgSession++
})

// ── FEAT-077 · link modal ───────────────────────────────────────────────────────────────────────────────────────────
const linkOpen = ref(false)
const linking = ref<PrefixView | null>(null)

function openLink(prefix: PrefixView) {
  linking.value = prefix
  linkOpen.value = true
}

function onLinked(prefix: PrefixDetailView) {
  list.value = prefixes.value.map(p => (p.id === prefix.id ? { ...p, telegram: prefix.telegram } : p))
  void load()
}

// ── FEAT-077 · unlink ───────────────────────────────────────────────────────────────────────────────────────────────
const unlinkTarget = ref<PrefixView | null>(null)
const unlinkOpen = ref(false)
const unlinking = ref(false)
const unlinkContent = { 'data-testid': 'st-prefix-tg-unlink-confirm' } as ModalProps['content']

function askUnlink(prefix: PrefixView) {
  unlinkTarget.value = prefix
  unlinkOpen.value = true
}

async function confirmUnlink() {
  const prefix = unlinkTarget.value
  if (!prefix || unlinking.value) return
  unlinking.value = true
  try {
    // retry: 0 — exactly one DELETE per confirm
    await api(`/prefixes/${encodeURIComponent(prefix.id)}/telegram`, { method: 'DELETE', retry: 0 })
    list.value = prefixes.value.map(p => (p.id === prefix.id
      ? { ...p, telegram: { linked: false, chatTitle: null, failedAt: null } }
      : p))
    toast.add({ title: `ถอดกลุ่มของ prefix ${prefix.code} แล้ว`, icon: 'i-lucide-check', color: 'success' })
    void load()
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({ title: 'ถอดกลุ่มไม่สำเร็จ', description: err.data?.error ?? err.message ?? 'ลองอีกครั้ง', color: 'error' })
  } finally {
    unlinking.value = false
    unlinkOpen.value = false
  }
}

// ── GOD modal ───────────────────────────────────────────────────────────────────────────────────────────────────────
const modalOpen = ref(false)
const editing = ref<PrefixView | null>(null)

function openCreate() {
  editing.value = null
  modalOpen.value = true
}
function openEdit(prefix: PrefixView) {
  editing.value = prefix
  modalOpen.value = true
}

/** 201 → the row is appended at once (API order = createdAt asc), then the list is re-read (§7) */
function onCreated(prefix: PrefixView) {
  list.value = [...prefixes.value.filter(p => p.id !== prefix.id), prefix]
  void load()
}
/** 200 → the row is replaced at once, then the list is re-read (§7) */
function onUpdated(prefix: PrefixView) {
  list.value = prefixes.value.map(p => (p.id === prefix.id ? prefix : p))
  void load()
}

const emptyText = computed(() => (isGod.value ? 'ยังไม่มี prefix' : 'ยังไม่มี prefix ที่คุณดูแล'))
</script>

<template>
  <div
    class="flex flex-col gap-4"
    data-testid="st-prefixes-page"
    :data-state="pageState"
    :data-count="prefixes.length"
    :data-role="isGod ? 'god' : 'admin'"
  >
    <UPageCard
      title="Prefixes"
      description="Prefix ใช้กำหนดเส้นทางของบัญชี (UTM · แจ้งเตือน) ไม่ใช่สิทธิ์การเข้าถึงบัญชี"
      variant="naked"
      orientation="horizontal"
    >
      <UButton
        v-if="isGod"
        label="เพิ่ม prefix"
        icon="i-lucide-plus"
        color="primary"
        class="w-fit lg:ms-auto"
        :disabled="pageState !== 'ready'"
        data-testid="st-prefixes-add"
        @click="openCreate()"
      />
    </UPageCard>

    <UAlert
      v-if="!isGod"
      color="neutral"
      variant="subtle"
      icon="i-lucide-eye"
      description="คุณเห็นเฉพาะ prefix ที่คุณดูแล · GOD เป็นผู้แก้ไข"
      data-testid="st-prefixes-readonly"
    />

    <UAlert
      v-if="tgOff"
      color="warning"
      variant="subtle"
      icon="i-lucide-send"
      :description="tgOff.text"
      :data-reason="tgOff.reason"
      data-testid="st-prefixes-tg-off"
    />

    <div v-if="pageState === 'loading'" class="flex flex-col gap-2" data-testid="st-prefixes-loading">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-24 w-full" />
    </div>

    <UAlert
      v-else-if="pageState === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดรายการ Prefix ไม่สำเร็จ"
      role="alert"
      data-testid="st-prefixes-error"
    >
      <template #description>
        <span class="break-words">{{ loadError ?? LOAD_FALLBACK }}</span>
      </template>
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          variant="solid"
          size="xs"
          :loading="pending"
          data-testid="st-prefixes-retry"
          @click="retry()"
        />
      </template>
    </UAlert>

    <UPageCard v-else-if="prefixes.length === 0" variant="subtle">
      <p class="text-sm text-muted" data-testid="st-prefixes-empty">
        {{ emptyText }}
      </p>
    </UPageCard>

    <UPageCard v-else variant="subtle" :ui="{ container: 'min-w-0 p-0 sm:p-0', wrapper: 'min-w-0' }">
      <div class="max-w-full overflow-x-auto">
        <table class="w-full min-w-[40rem] text-left text-sm" data-testid="st-prefixes-table">
          <thead class="bg-elevated/50 text-xs text-muted">
            <tr>
              <th class="px-3 py-2 font-medium whitespace-nowrap">
                Code
              </th>
              <th class="px-3 py-2 font-medium whitespace-nowrap">
                Name
              </th>
              <th class="px-3 py-2 font-medium whitespace-nowrap">
                Admin ที่ดูแล
              </th>
              <th class="px-3 py-2 text-right font-medium whitespace-nowrap">
                บัญชี
              </th>
              <th class="px-3 py-2 font-medium whitespace-nowrap">
                สถานะ
              </th>
              <th class="px-3 py-2 font-medium whitespace-nowrap">
                Telegram
              </th>
              <th v-if="isGod" class="px-3 py-2">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="prefix in prefixes"
              :key="prefix.id"
              class="border-t border-default align-top"
              data-testid="st-prefix-row"
              :data-id="prefix.id"
              :data-code="prefix.code"
              :data-status="prefix.status"
            >
              <td class="px-3 py-2 font-mono whitespace-nowrap text-highlighted" data-testid="st-prefix-code">
                {{ prefix.code }}
              </td>
              <td class="px-3 py-2" :class="prefix.name ? '' : 'text-muted'" data-testid="st-prefix-name">
                {{ prefix.name ?? '—' }}
              </td>
              <td class="px-3 py-2" data-testid="st-prefix-admins">
                <div v-if="prefix.admins.length" class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="a in prefix.admins"
                    :key="a.id"
                    :label="a.displayName"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    :data-admin-id="a.id"
                    data-testid="st-prefix-admin"
                  />
                </div>
                <span v-else class="text-muted">—</span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums" data-testid="st-prefix-accounts">
                {{ prefix.accountCount }}
              </td>
              <td class="px-3 py-2" data-testid="st-prefix-status">
                <UBadge
                  :label="PREFIX_STATUS_LABEL[prefix.status]"
                  :color="prefix.status === 'active' ? 'success' : 'neutral'"
                  variant="subtle"
                  size="sm"
                  class="whitespace-nowrap"
                />
              </td>
              <td class="px-3 py-2" data-testid="st-prefix-telegram" :data-tg="tgState(prefix)">
                <div class="flex flex-wrap items-center gap-1.5">
                  <template v-if="tgState(prefix) === 'none'">
                    <span class="text-muted whitespace-nowrap">ยังไม่ผูก</span>
                    <UButton
                      v-if="tgOn"
                      label="ผูกกลุ่ม"
                      icon="i-lucide-send"
                      color="primary"
                      variant="soft"
                      size="xs"
                      data-testid="st-prefix-tg-link"
                      @click="openLink(prefix)"
                    />
                  </template>
                  <template v-else>
                    <UBadge
                      v-if="tgState(prefix) === 'failed'"
                      label="กลุ่มใช้ไม่ได้"
                      color="error"
                      variant="subtle"
                      size="sm"
                      icon="i-lucide-triangle-alert"
                      class="whitespace-nowrap"
                      :title="`ตั้งแต่ ${formatDateTime(prefix.telegram.failedAt)}`"
                      data-testid="st-prefix-tg-failed"
                    />
                    <span class="break-words text-highlighted" data-testid="st-prefix-tg-title">{{ prefix.telegram.chatTitle || '—' }}</span>
                    <UButton
                      v-if="tgOn && tgState(prefix) === 'failed'"
                      label="ผูกใหม่"
                      icon="i-lucide-send"
                      color="primary"
                      variant="soft"
                      size="xs"
                      data-testid="st-prefix-tg-relink"
                      @click="openLink(prefix)"
                    />
                    <UButton
                      v-if="tgOn"
                      label="ถอด"
                      icon="i-lucide-unlink"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      data-testid="st-prefix-tg-unlink"
                      @click="askUnlink(prefix)"
                    />
                  </template>
                </div>
              </td>
              <td v-if="isGod" class="px-3 py-1.5 text-right">
                <UButton
                  icon="i-lucide-pencil"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`แก้ไข prefix ${prefix.code}`"
                  data-testid="st-prefix-edit"
                  @click="openEdit(prefix)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </UPageCard>

    <PrefixesTelegramLinkModal
      v-model:open="linkOpen"
      :prefix="linking"
      @linked="onLinked"
    />

    <UModal
      v-model:open="unlinkOpen"
      :title="`ถอดกลุ่ม Telegram ของ prefix ${unlinkTarget?.code ?? ''}`"
      :description="`กลุ่ม ${unlinkTarget?.telegram.chatTitle || '—'} จะไม่ได้รับ QR เติมเงินใหม่ของ prefix นี้อีก · รอบที่ส่งไปแล้วยังจ่ายในกลุ่มได้`"
      :dismissible="!unlinking"
      :ui="{ content: 'max-w-md' }"
      :content="unlinkContent"
    >
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="unlinking"
            data-testid="st-prefix-tg-unlink-no"
            @click="unlinkOpen = false"
          />
          <UButton
            label="ถอด"
            icon="i-lucide-unlink"
            color="error"
            :loading="unlinking"
            data-testid="st-prefix-tg-unlink-yes"
            @click="confirmUnlink()"
          />
        </div>
      </template>
    </UModal>

    <PrefixesFormModal
      v-if="isGod"
      v-model:open="modalOpen"
      :prefix="editing"
      @created="onCreated"
      @updated="onUpdated"
    />
  </div>
</template>
