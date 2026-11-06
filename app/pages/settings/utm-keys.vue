<script setup lang="ts">
/**
 * FEAT-090 — `/settings/utm-keys` (GOD only; spec "UI behaviour" §3, api-contract v1 §3 / §7).
 *
 * One UTM key (`prefix` + `sourceId` + `mediumId` + `campaignId`) belongs to exactly one admin: the row is
 * claimed when an ad template first saves that key, and every report (UTM · Performance · Dashboard) counts its
 * sign-ups / deposits for that owner. This page is the only place where a key changes hands — there is no create
 * and no delete.
 *
 * FEAT-099: the owner cell is the **holder** (`st-uk-owner`), a muted `st-uk-released` badge marks a key whose holder
 * stepped back (another admin may claim it; the holder keeps earning until then), and the row action
 * `st-uk-release` (enabled only while held) → confirm (`st-uk-release-modal`) → one `POST /utm-keys/:id/release`.
 * The modal shows the ownership timeline and `PATCH` there is a handover.
 *
 * Requests (`useApi`, `retry: 0`): `GET /utm-keys[?ownerAdminId=&prefix=]` on mount, on every filter change, on
 * Refresh and after a successful move · `GET /admins` + `GET /prefixes?status=all` once per page load (they fill
 * the two filters and the modal's select) · `PATCH /utm-keys/:id { ownerAdminId }` from `UtmKeysOwnerModal` · `POST /utm-keys/:id/release` from here.
 *
 * The **URL is the filter state** (`?owner=&prefix=`, the report-page pattern): a select writes it with
 * `router.replace`, and the query change issues exactly one list request (a session counter drops the answer of
 * a superseded query). Guard: `utm-keys-access` (GOD passes · Admin → `/settings/prefixes` · anybody else →
 * home, both with the "Not allowed" toast); the API (`@Roles('GOD')`) is the authority.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdminsResponse } from '#shared/types/admins'
import type { PrefixesResponse } from '#shared/types/prefixes'
import type { UtmKeyView, UtmKeysResponse } from '#shared/types/utm-keys'

definePageMeta({ middleware: 'utm-keys-access' })

useSeoMeta({ title: 'UTM keys' })

const LOAD_FALLBACK = 'โหลดรายการ UTM key ไม่สำเร็จ'
const ADMINS_FALLBACK = 'โหลดรายชื่อ admin ไม่สำเร็จ'
const PREFIXES_FALLBACK = 'โหลดรายการ prefix ไม่สำเร็จ'
const EMPTY_TEXT = 'ยังไม่มี UTM key — key จะถูกจองเมื่อมีคน save template ที่ผูก UTM'
/** sentinels of the two "all" options (never sent to the API) */
const ALL_OWNERS = 'all'
const ALL_PREFIXES = 'all'

const api = useApi()
const toast = useToast()
const route = useRoute()
const router = useRouter()

// ── url state (the only trigger) ─────────────────────────────────────────────────────────────────────────────────────
function queryString(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value.trim() : ''
}

const ownerFilter = computed(() => queryString('owner') || ALL_OWNERS)
const prefixFilter = computed(() => queryString('prefix') || ALL_PREFIXES)

/** merge a patch into the query; an empty / "all" value drops the key entirely */
function setQuery(patch: Record<string, string | undefined>) {
  const merged = { ...route.query, ...patch }
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && value !== '') next[key] = value
  }
  void router.replace({ query: next })
}

const ownerModel = computed({
  get: () => ownerFilter.value,
  set: (value: string) => setQuery({ owner: value === ALL_OWNERS ? undefined : value })
})
const prefixModel = computed({
  get: () => prefixFilter.value,
  set: (value: string) => setQuery({ prefix: value === ALL_PREFIXES ? undefined : value })
})

// ── the list ─────────────────────────────────────────────────────────────────────────────────────────────────────────
type PageState = 'loading' | 'ready' | 'error'

const list = ref<UtmKeyView[] | null>(null)
const count = ref(0)
const pending = ref(true)
const loadError = ref<string | null>(null)
let session = 0
const releaseError = ref<string | null>(null)

const keys = computed<UtmKeyView[]>(() => list.value ?? [])
const pageState = computed<PageState>(() => {
  if (loadError.value) return 'error'
  if (list.value === null) return 'loading'
  return 'ready'
})

async function load() {
  const s = ++session
  pending.value = true
  loadError.value = null
  releaseError.value = null
  releaseError.value = null
  const query: Record<string, string> = {}
  if (ownerFilter.value !== ALL_OWNERS) query.ownerAdminId = ownerFilter.value
  if (prefixFilter.value !== ALL_PREFIXES) query.prefix = prefixFilter.value
  try {
    const res = await api<UtmKeysResponse>('/utm-keys', { query, retry: 0 })
    if (s !== session) return
    list.value = res.keys ?? []
    count.value = res.count ?? (res.keys?.length ?? 0)
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    list.value = null
    count.value = 0
    loadError.value = err.data?.error ?? err.message ?? LOAD_FALLBACK
  } finally {
    if (s === session) pending.value = false
  }
}

// ── filter options (one request each per page load) ──────────────────────────────────────────────────────────────────
interface SelectItem { value: string, label: string }

const admins = ref<SelectItem[]>([])
const adminsError = ref<string | null>(null)
const prefixCodes = ref<string[]>([])
const prefixesError = ref<string | null>(null)

async function loadAdmins() {
  try {
    const res = await api<AdminsResponse>('/admins', { retry: 0 })
    admins.value = (res.admins ?? [])
      .filter(a => a.status !== 'deleted')
      .map(a => ({ value: a.id, label: a.displayName }))
    adminsError.value = null
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    admins.value = []
    adminsError.value = err.data?.error ?? err.message ?? ADMINS_FALLBACK
  }
}

async function loadPrefixes() {
  try {
    const res = await api<PrefixesResponse>('/prefixes', { query: { status: 'all' }, retry: 0 })
    prefixCodes.value = (res.prefixes ?? []).map(p => p.code)
    prefixesError.value = null
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    prefixCodes.value = []
    prefixesError.value = err.data?.error ?? err.message ?? PREFIXES_FALLBACK
  }
}

/** the owner filter also offers an owner the admin list does not contain (deleted admin, failed request) */
const ownerItems = computed<SelectItem[]>(() => {
  const base = [{ value: ALL_OWNERS, label: 'ทุกคน' }, ...admins.value]
  const picked = ownerFilter.value
  if (picked === ALL_OWNERS || base.some(i => i.value === picked)) return base
  const known = keys.value.find(k => k.owner?.id === picked)?.owner
  return [...base, { value: picked, label: known?.displayName ?? picked }]
})

const prefixItems = computed<SelectItem[]>(() => {
  const codes = [...new Set([...prefixCodes.value, ...keys.value.map(k => k.prefix)])]
  const base = [{ value: ALL_PREFIXES, label: 'ทุก prefix' }, ...codes.map(code => ({ value: code, label: code }))]
  const picked = prefixFilter.value
  if (picked === ALL_PREFIXES || base.some(i => i.value === picked)) return base
  return [...base, { value: picked, label: picked }]
})

// one list request per query change (the filters write the URL, nothing else fetches)
watch(() => [ownerFilter.value, prefixFilter.value].join('|'), () => {
  void load()
})

onMounted(() => {
  void load()
  void loadAdmins()
  void loadPrefixes()
})
onUnmounted(() => {
  session++
})

// ── the modal ────────────────────────────────────────────────────────────────────────────────────────────────────────
const modalOpen = ref(false)
const editing = ref<UtmKeyView | null>(null)

function openEdit(row: UtmKeyView) {
  editing.value = row
  modalOpen.value = true
}

/** 200 → the row is replaced at once, then the list is re-read (the owner decides the sort of nothing, but the
 * counts and `lastFactDay` are the API's) */
function onMoved(row: UtmKeyView) {
  list.value = keys.value.map(k => (k.id === row.id ? row : k))
  if (editing.value?.id === row.id) editing.value = row
  void load()
}

// ── release (FEAT-099) ──────────────────────────────────────────────────────────────────────────────────────────────
const RELEASE_FALLBACK = 'ปล่อย key ไม่สำเร็จ'
const releaseOpen = ref(false)
const releasing = ref<UtmKeyView | null>(null)
const releaseBusy = ref(false)
const releaseModalContent = { 'data-testid': 'st-uk-release-modal' } as ModalProps['content']

function askRelease(row: UtmKeyView) {
  releasing.value = row
  releaseOpen.value = true
}

function releaseTitle(row: UtmKeyView): string {
  return row.released ? 'ปล่อยแล้ว — ไม่มีอะไรต้องทำ' : 'ปล่อย key นี้ให้แอดมินคนอื่นรับไปใช้'
}

function releasedTitle(row: UtmKeyView): string {
  const r = row.released
  if (!r) return ''
  const by = r.by ? ` · โดย ${r.by.displayName}` : ''
  return `${RELEASE_REASON_TEXT[r.reason] ?? r.reason}${by} · ยอดยังเข้าผู้ถือ key จนกว่าจะมีคนรับไปใช้`
}

async function confirmRelease() {
  const row = releasing.value
  if (!row || releaseBusy.value) return
  releaseBusy.value = true
  releaseError.value = null
  try {
    // retry: 0 — exactly one POST per confirm
    const res = await api<UtmKeyView>(`/utm-keys/${encodeURIComponent(row.id)}/release`, { method: 'POST', body: {}, retry: 0 })
    list.value = keys.value.map(k => (k.id === res.id ? res : k))
    releaseOpen.value = false
    toast.add({ title: 'ปล่อย key แล้ว', icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
    // a 4xx shows the API's message verbatim in the page's error element; the row is not touched
    releaseError.value = issues.length ? issues.join(' · ') : (err.data?.error ?? err.message ?? RELEASE_FALLBACK)
    releaseOpen.value = false
  } finally {
    releaseBusy.value = false
  }
}

const footerText = computed(() => `ทั้งหมด ${formatInt(count.value)} key`)
</script>

<template>
  <div
    class="flex flex-col gap-4"
    data-testid="st-uk-page"
    :data-state="pageState"
    :data-count="keys.length"
    :data-owner="ownerFilter"
    :data-prefix="prefixFilter"
  >
    <UPageCard
      title="UTM keys"
      description="หนึ่ง key = หนึ่งเจ้าของ · รายงานคิดตามเจ้าของ"
      variant="naked"
      orientation="horizontal"
    >
      <UButton
        label="Refresh"
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        class="w-fit lg:ms-auto"
        :loading="pending"
        data-testid="st-uk-refresh"
        @click="load()"
      />
    </UPageCard>

    <div class="flex flex-wrap items-end gap-3">
      <UFormField label="เจ้าของ" class="w-full sm:w-56">
        <USelect
          v-model="ownerModel"
          :items="ownerItems"
          value-key="value"
          icon="i-lucide-user"
          class="w-full"
          data-testid="st-uk-owner-filter"
        />
      </UFormField>
      <UFormField label="Prefix" class="w-full sm:w-48">
        <USelect
          v-model="prefixModel"
          :items="prefixItems"
          value-key="value"
          icon="i-lucide-tag"
          class="w-full"
          data-testid="st-uk-prefix-filter"
        />
      </UFormField>
    </div>

    <UAlert
      v-if="releaseError"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="ปล่อย key ไม่สำเร็จ"
      role="alert"
      data-testid="st-uk-error"
      :close="true"
      @update:open="releaseError = null"
    >
      <template #description>
        <span class="break-words">{{ releaseError }}</span>
      </template>
    </UAlert>

    <p v-if="adminsError || prefixesError" class="text-xs text-warning" data-testid="st-uk-options-error">
      {{ [adminsError, prefixesError].filter(Boolean).join(' · ') }}
    </p>

    <div v-if="pageState === 'loading'" class="flex flex-col gap-2" data-testid="st-uk-loading">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-24 w-full" />
    </div>

    <UAlert
      v-else-if="pageState === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดรายการ UTM key ไม่สำเร็จ"
      role="alert"
      data-testid="st-uk-error"
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
          data-testid="st-uk-retry"
          @click="load()"
        />
      </template>
    </UAlert>

    <UPageCard v-else-if="keys.length === 0" variant="subtle">
      <p class="text-sm text-muted" data-testid="st-uk-empty">
        {{ EMPTY_TEXT }}
      </p>
    </UPageCard>

    <template v-else>
      <!-- the table is the only wide thing here: it scrolls inside its card, the page never scrolls sideways -->
      <UPageCard variant="subtle" :ui="{ container: 'min-w-0 p-0 sm:p-0', wrapper: 'min-w-0' }">
        <div class="max-w-full overflow-x-auto">
          <table class="w-full min-w-[52rem] text-left text-sm" data-testid="st-uk-table">
            <thead class="bg-elevated/50 text-xs text-muted">
              <tr>
                <th class="px-3 py-2 font-medium whitespace-nowrap">
                  Prefix
                </th>
                <th class="px-3 py-2 font-medium whitespace-nowrap">
                  Source
                </th>
                <th class="px-3 py-2 font-medium whitespace-nowrap">
                  Medium
                </th>
                <th class="px-3 py-2 font-medium whitespace-nowrap">
                  Campaign
                </th>
                <th class="px-3 py-2 font-medium whitespace-nowrap">
                  เจ้าของ
                </th>
                <th class="px-3 py-2 text-right font-medium whitespace-nowrap">
                  Templates
                </th>
                <th class="px-3 py-2 text-right font-medium whitespace-nowrap">
                  Builds
                </th>
                <th class="px-3 py-2 font-medium whitespace-nowrap">
                  ยอดล่าสุด
                </th>
                <th class="px-3 py-2">
                  <span class="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody :class="pending ? 'opacity-60' : ''">
              <tr
                v-for="row in keys"
                :key="row.id"
                class="border-t border-default align-top"
                data-testid="st-uk-row"
                :data-id="row.id"
                :data-owner="row.owner?.id ?? ''"
              >
                <td class="px-3 py-2 font-mono whitespace-nowrap text-highlighted" data-testid="st-uk-prefix">
                  {{ row.prefix }}
                </td>
                <td class="px-3 py-2" data-testid="st-uk-source">
                  {{ row.source || REPORT_DASH }}
                </td>
                <td class="px-3 py-2" data-testid="st-uk-medium">
                  {{ row.medium || REPORT_DASH }}
                </td>
                <td class="px-3 py-2" data-testid="st-uk-campaign">
                  {{ row.campaign || REPORT_DASH }}
                </td>
                <td
                  class="px-3 py-2"
                  :class="row.owner ? 'text-highlighted' : 'text-muted'"
                  data-testid="st-uk-owner"
                >
                  <span class="break-words">{{ row.owner?.displayName ?? REPORT_DASH }}</span>
                  <UBadge
                    v-if="row.released"
                    label="ปล่อยแล้ว"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    class="ms-1.5 align-middle"
                    :title="releasedTitle(row)"
                    :data-reason="row.released.reason"
                    data-testid="st-uk-released"
                  />
                </td>
                <td class="px-3 py-2 text-right tabular-nums" data-testid="st-uk-templates">
                  {{ formatInt(row.templateCount) }}
                </td>
                <td class="px-3 py-2 text-right tabular-nums" data-testid="st-uk-builds">
                  {{ formatInt(row.buildCount) }}
                </td>
                <td
                  class="px-3 py-2 whitespace-nowrap tabular-nums"
                  :class="row.lastFactDay ? '' : 'text-muted'"
                  data-testid="st-uk-last-fact"
                >
                  {{ row.lastFactDay ?? REPORT_DASH }}
                </td>
                <td class="px-3 py-1.5 text-right whitespace-nowrap">
                  <UButton
                    label="ปล่อย"
                    icon="i-lucide-unlock"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="whitespace-nowrap"
                    :disabled="row.released != null"
                    :title="releaseTitle(row)"
                    data-testid="st-uk-release"
                    @click="askRelease(row)"
                  />
                  <UButton
                    label="ส่งต่อเจ้าของ"
                    icon="i-lucide-user-cog"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    class="whitespace-nowrap"
                    data-testid="st-uk-edit"
                    @click="openEdit(row)"
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UPageCard>

      <p class="text-xs text-muted tabular-nums" data-testid="st-uk-footer">
        {{ footerText }}
      </p>
    </template>

    <UModal
      v-model:open="releaseOpen"
      title="ปล่อย UTM key นี้?"
      description="แอดมินคนอื่นจะ save template ที่ผูก key นี้ได้ · ผู้ถือ key ปัจจุบันยังได้ยอดของ key นี้ต่อจนกว่าจะมีคนรับไปใช้"
      :dismissible="!releaseBusy"
      :ui="{ content: 'max-w-md' }"
      :content="releaseModalContent"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <dl v-if="releasing" class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt class="text-muted">
              Prefix
            </dt>
            <dd class="font-mono break-all text-highlighted">
              {{ releasing.prefix }}
            </dd>
            <dt class="text-muted">
              Campaign
            </dt>
            <dd class="break-all text-highlighted">
              {{ releasing.campaign || REPORT_DASH }}
            </dd>
            <dt class="text-muted">
              ผู้ถือ key
            </dt>
            <dd class="break-words text-highlighted">
              {{ releasing.owner?.displayName ?? REPORT_DASH }}
            </dd>
          </dl>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              label="ยกเลิก"
              color="neutral"
              variant="subtle"
              :disabled="releaseBusy"
              data-testid="st-uk-release-cancel"
              @click="releaseOpen = false"
            />
            <UButton
              label="ปล่อย key"
              icon="i-lucide-unlock"
              color="primary"
              :loading="releaseBusy"
              data-testid="st-uk-release-confirm"
              @click="confirmRelease()"
            />
          </div>
        </div>
      </template>
    </UModal>

    <UtmKeysOwnerModal
      v-model:open="modalOpen"
      :utm-key="editing"
      :admins="admins"
      :admins-error="adminsError"
      @moved="onMoved"
    />
  </div>
</template>
