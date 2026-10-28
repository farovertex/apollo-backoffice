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
 * narrow viewports. `st-prefix-telegram` is "—" in this feature (FEAT-C links chats).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PrefixView, PrefixesResponse } from '#shared/types/prefixes'

definePageMeta({ middleware: 'prefixes-access' })

useSeoMeta({ title: 'Prefixes' })

const LOAD_FALLBACK = 'โหลดรายการ Prefix ไม่สำเร็จ'

const api = useApi()
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

onMounted(() => {
  void load()
})
onUnmounted(() => {
  session++
})

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
          @click="load()"
        />
      </template>
    </UAlert>

    <UPageCard v-else-if="prefixes.length === 0" variant="subtle">
      <p class="text-sm text-muted" data-testid="st-prefixes-empty">
        {{ emptyText }}
      </p>
    </UPageCard>

    <UPageCard v-else variant="subtle" :ui="{ container: 'p-0 sm:p-0', wrapper: 'min-w-0' }">
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
              <td class="px-3 py-2 font-mono break-all text-highlighted" data-testid="st-prefix-code">
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
              <td class="px-3 py-2" :class="prefix.telegram.linked ? '' : 'text-muted'" data-testid="st-prefix-telegram">
                {{ prefix.telegram.linked ? (prefix.telegram.chatTitle ?? '—') : '—' }}
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

    <PrefixesFormModal
      v-if="isGod"
      v-model:open="modalOpen"
      :prefix="editing"
      @created="onCreated"
      @updated="onUpdated"
    />
  </div>
</template>
