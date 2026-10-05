<script setup lang="ts">
/**
 * FEAT-006 — Proxies (function 2.9; api-contract.md v1 "GET/POST/PATCH/DELETE /proxies").
 * Server-side list: exactly one `GET /backend/proxies?page=<n>&limit=20[&q=<q>]` per load / Refresh / page change /
 * 300 ms-debounced search / after create / edit / delete (`q` is omitted while the search box is empty). Count line
 * and pagination come from `total`, never from the rendered rows.
 * The table is plain markup (not `UTable`) so every `<tr>` can carry `data-id` — QA addresses rows as
 * `[data-testid="px-table"] tbody tr`.
 * Password: `PasswordCell` renders the literal mask; the plaintext enters the DOM only while that row's toggle is on
 * (human decision 2026-09-22, same as TIKTOK_ACCOUNTS.password) and is never logged or screenshotted.
 *
 * FEAT-027 — 1:1 binding, connectivity check and batch CSV upload (api-contract.md v1 §3/§4/§9/§10, spec.md "UI
 * behaviour", AC-9..12, AC-14). Two new columns: **Bound to** (`px-bound`, a link to `/browser-profiles?q=<name>`
 * when bound, "—" + a Free badge otherwise) and **Last check** (`px-last-check`, ✓/✗/"never" + time ago, IP on
 * success, error in a tooltip on failure). Row action **Check** (`px-check`) runs `POST /proxies/:id/check` and
 * merges the 200 result into that row in place (no refetch needed — the response already has everything). Toolbar
 * **Check all** (`px-check-all`) runs the same call for every row of the *current page*, three at a time
 * (`PromisePool`-style worker loop), with a progress indicator (`px-check-progress`) and is disabled while running
 * (AS-7: current page only, not every proxy in the system). Toolbar **Batch upload** (`px-batch-upload`) opens
 * `ProxiesBatchModal`; a successful import refreshes the list back to page 1 (new rows sort by label).
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { BatchProxiesResponse, CheckProxyResponse, DeleteProxyResponse, ProxiesResponse, Proxy } from '#shared/types/proxies'

useSeoMeta({ title: 'Proxies' })

const LIMIT = 20
const DEBOUNCE_MS = 300

const api = useApi()
const toast = useToast()

// ── password reveal (per proxy id, owned here so a re-render never leaks a revealed cell to another row) ─────────────
const revealed = ref(new Set<string>())
function toggleRevealed(id: string) {
  const next = new Set(revealed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  revealed.value = next
}

// ── list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const page = ref(1)
const search = ref('')
const searchDebounced = refDebounced(search, DEBOUNCE_MS)

const items = ref<Proxy[]>([])
const total = ref(0)
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
// bumped on every request so a late response from a superseded query is dropped
let session = 0

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  const q = searchDebounced.value.trim()
  try {
    // retry: 0 — exactly one request per load, ofetch must not re-issue it on 5xx
    const res = await api<ProxiesResponse>('/proxies', {
      retry: 0,
      query: { page: page.value, limit: LIMIT, q: q || undefined }
    })
    if (s !== session) return
    items.value = res.proxies ?? []
    total.value = res.total ?? items.value.length
    loaded.value = true
    // a fresh dataset always starts fully masked
    revealed.value = new Set()
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    items.value = []
    total.value = 0
    error.value = err.data?.error ?? err.message ?? 'Unexpected error'
  } finally {
    if (s === session) pending.value = false
  }
}

// a new search starts at page 1 — registered before the queryKey watcher so both changes collapse into one request
watch(searchDebounced, () => {
  page.value = 1
})

const queryKey = computed(() => `${page.value}|${searchDebounced.value.trim()}`)
watch(queryKey, () => {
  void load()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

/** one request after a mutation: either through the page watcher (page really changes) or directly */
function reload(target?: number) {
  if (target !== undefined && target !== page.value) page.value = target
  else void load()
}

const hasSearch = computed(() => searchDebounced.value.trim() !== '')
const isEmpty = computed(() => loaded.value && !error.value && total.value === 0 && !hasSearch.value)
const isNoMatch = computed(() => loaded.value && !error.value && total.value === 0 && hasSearch.value)
const showTable = computed(() => !error.value && !isEmpty.value && !isNoMatch.value)

function clearSearch() {
  search.value = ''
}

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const now = useNow({ interval: 30_000 })
function timeAgo(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}

const TYPE_COLOR: Record<Proxy['type'], 'primary' | 'success' | 'warning'> = {
  http: 'primary',
  https: 'success',
  socks5: 'warning'
}

// row actions show their label only from `2xl` (1536 px); below that they are icon-only with a tooltip (FEAT-003)
const wideActions = useMediaQuery('(min-width: 1536px)')
const ACTION_LABEL_UI = { label: 'hidden 2xl:inline' }

// ── modals ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const formOpen = ref(false)
const formTarget = ref<Proxy | null>(null)
const deleteOpen = ref(false)
const deleteTarget = ref<Proxy | null>(null)

function openAdd() {
  formTarget.value = null
  formOpen.value = true
}

function openEdit(proxy: Proxy) {
  formTarget.value = proxy
  formOpen.value = true
}

function askDelete(proxy: Proxy) {
  deleteTarget.value = proxy
  deleteOpen.value = true
}

function onCreated() {
  // the new row sorts by label — always come back to page 1 so it is visible
  reload(1)
}

function onUpdated() {
  reload()
}

function onDeleted(_res: DeleteProxyResponse) {
  // last row of a page → step back one page, otherwise reload the current one (one request either way)
  reload(items.value.length === 1 && page.value > 1 ? page.value - 1 : undefined)
}

// ── check / check all (FEAT-027 §9, AC-9, AS-7) ─────────────────────────────────────────────────────────────────────
const checking = ref(new Set<string>())
function setChecking(id: string, on: boolean) {
  const next = new Set(checking.value)
  if (on) next.add(id)
  else next.delete(id)
  checking.value = next
}

const checkingAll = ref(false)
const checkAllDone = ref(0)
const checkAllTotal = ref(0)
const CHECK_CONCURRENCY = 3

/** one `POST /proxies/:id/check`; merges the 200 result into the row in place — no refetch needed */
async function checkOne(proxy: Proxy) {
  if (checking.value.has(proxy.id)) return
  setChecking(proxy.id, true)
  try {
    // retry: 0 — exactly one check per click/slot (the endpoint always answers 200, ok/error is in the body)
    const res = await api<CheckProxyResponse>(`/proxies/${encodeURIComponent(proxy.id)}/check`, { method: 'POST', retry: 0 })
    const target = items.value.find(p => p.id === proxy.id)
    if (target) target.lastCheck = { at: res.checkedAt, ok: res.ok, ip: res.ip, error: res.error }
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: `Could not check ${proxy.label}`,
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
  } finally {
    setChecking(proxy.id, false)
  }
}

/** every row of the *current page*, `CHECK_CONCURRENCY` at a time (AS-7: not every proxy in the system) */
async function checkAll() {
  if (checkingAll.value || pending.value || items.value.length === 0) return
  checkingAll.value = true
  checkAllDone.value = 0
  checkAllTotal.value = items.value.length
  const queue = [...items.value]
  async function worker() {
    for (let proxy = queue.shift(); proxy; proxy = queue.shift()) {
      await checkOne(proxy)
      checkAllDone.value++
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(CHECK_CONCURRENCY, queue.length) }, () => worker()))
  } finally {
    checkingAll.value = false
  }
}

// ── batch upload (FEAT-027 §10/§11, AC-10) ──────────────────────────────────────────────────────────────────────────
const batchOpen = ref(false)

function onImported(_res: BatchProxiesResponse) {
  // new rows sort by label — always come back to page 1 so they are visible
  reload(1)
}
</script>

<template>
  <UDashboardPanel id="proxies">
    <template #header>
      <UDashboardNavbar title="Proxies">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <!-- four buttons clip the H1 (`truncate`) at 390 px → icon-only below `sm`/`lg`, aria-label keeps the name -->
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="px-refresh"
            @click="reload()"
          />
          <UButton
            label="Check all"
            aria-label="Check all"
            icon="i-lucide-plug-zap"
            color="neutral"
            variant="outline"
            :loading="checkingAll"
            :disabled="pending || items.length === 0"
            :ui="{ label: 'hidden lg:inline' }"
            data-testid="px-check-all"
            @click="checkAll()"
          />
          <UButton
            label="Batch upload"
            aria-label="Batch upload"
            icon="i-lucide-file-up"
            color="neutral"
            variant="outline"
            :ui="{ label: 'hidden lg:inline' }"
            data-testid="px-batch-upload"
            @click="batchOpen = true"
          />
          <UButton
            label="Add proxy"
            aria-label="Add proxy"
            icon="i-lucide-plus"
            color="primary"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="px-add"
            @click="openAdd"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div data-testid="px-page" :data-pending="pending ? 'true' : 'false'" class="flex flex-1 flex-col gap-4">
        <div class="flex flex-wrap items-center gap-1.5">
          <UInput
            v-model="search"
            class="w-full sm:max-w-sm"
            icon="i-lucide-search"
            placeholder="Search label or host"
            data-testid="px-search"
          />
          <span
            v-if="checkingAll"
            class="flex items-center gap-1.5 text-sm text-muted"
            data-testid="px-check-progress"
          >
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
            Checking {{ checkAllDone }} / {{ checkAllTotal }}
          </span>
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load proxies"
          :description="error"
          data-testid="px-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="pending"
              data-testid="px-retry"
              @click="load()"
            />
          </template>
        </UAlert>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-network"
          title="No proxies yet"
          description="Add a proxy once and reuse it on every browser profile you create."
          data-testid="px-empty"
        >
          <template #actions>
            <UButton
              label="Add proxy"
              icon="i-lucide-plus"
              color="primary"
              data-testid="px-empty-add"
              @click="openAdd"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="isNoMatch"
          icon="i-lucide-search-x"
          title="No proxies match your search"
          data-testid="px-no-match"
        >
          <template #actions>
            <UButton
              label="Clear search"
              icon="i-lucide-x"
              color="neutral"
              variant="outline"
              data-testid="px-clear-search"
              @click="clearSearch"
            />
          </template>
        </UEmpty>

        <div v-if="showTable" class="overflow-x-auto" data-testid="px-table">
          <table class="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr class="bg-elevated/50">
                <th class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Label
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Type
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Host:port
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Username
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Password
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Country
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Scope
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Bound to
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Last check
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Created
                </th>
                <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody :class="pending ? 'opacity-60' : ''">
              <tr v-if="pending && items.length === 0" data-testid="px-loading">
                <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="11">
                  Loading proxies…
                </td>
              </tr>
              <!-- `data-slot="tr"` mirrors UTable's rows so a row locator works the same on every table of the BO -->
              <tr
                v-for="proxy in items"
                :key="proxy.id"
                :data-id="proxy.id"
                data-slot="tr"
                data-testid="px-row"
              >
                <td class="border-b border-default px-3 py-2">
                  <span class="font-medium whitespace-nowrap text-highlighted" data-testid="px-label">{{ proxy.label }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    :color="TYPE_COLOR[proxy.type] ?? 'neutral'"
                    variant="subtle"
                    class="whitespace-nowrap"
                    data-testid="px-type"
                    :data-type="proxy.type"
                  >
                    {{ proxy.type }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="font-mono text-xs whitespace-nowrap" data-testid="px-hostport">{{ proxy.host }}:{{ proxy.port }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span v-if="proxy.username" class="whitespace-nowrap" data-testid="px-username">{{ proxy.username }}</span>
                  <span v-else class="text-muted" data-testid="px-username">—</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <PasswordCell
                    v-if="proxy.password"
                    :key="proxy.id"
                    :value="proxy.password"
                    :shown="revealed.has(proxy.id)"
                    test-id-prefix="px"
                    @toggle="toggleRevealed(proxy.id)"
                  />
                  <span
                    v-else
                    class="text-muted"
                    data-testid="px-password"
                    data-shown="false"
                  >—</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span :class="proxy.country ? '' : 'text-muted'" data-testid="px-country">{{ proxy.country ?? '—' }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    color="neutral"
                    variant="outline"
                    class="whitespace-nowrap"
                    data-testid="px-scope"
                  >
                    {{ proxy.workspaceName ?? '—' }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2" data-testid="px-bound">
                  <template v-if="proxy.boundProfile">
                    <NuxtLink
                      v-if="proxy.boundProfile.name"
                      :to="`/browser-profiles?q=${encodeURIComponent(proxy.boundProfile.name)}`"
                      class="font-medium whitespace-nowrap text-primary hover:underline"
                      data-testid="px-bound-link"
                    >
                      {{ proxy.boundProfile.name }}
                    </NuxtLink>
                    <span v-else class="text-muted whitespace-nowrap">Bound (profile unknown)</span>
                  </template>
                  <div v-else class="flex items-center gap-1.5 whitespace-nowrap">
                    <span class="text-muted">—</span>
                    <UBadge
                      color="success"
                      variant="subtle"
                      size="sm"
                      data-testid="px-bound-free"
                    >
                      Free
                    </UBadge>
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2" data-testid="px-last-check">
                  <span v-if="!proxy.lastCheck" class="text-muted whitespace-nowrap">never</span>
                  <UTooltip v-else :text="proxy.lastCheck.ok ? undefined : (proxy.lastCheck.error ?? 'Check failed')" :disabled="proxy.lastCheck.ok">
                    <span class="inline-flex items-center gap-1 whitespace-nowrap" :title="proxy.lastCheck.at">
                      <UIcon
                        :name="proxy.lastCheck.ok ? 'i-lucide-check' : 'i-lucide-x'"
                        :class="proxy.lastCheck.ok ? 'text-success' : 'text-error'"
                        class="size-4"
                      />
                      {{ timeAgo(proxy.lastCheck.at) }}
                      <span v-if="proxy.lastCheck.ok && proxy.lastCheck.ip" class="text-muted">({{ proxy.lastCheck.ip }})</span>
                    </span>
                  </UTooltip>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" :title="proxy.createdAt" data-testid="px-created">{{ timeAgo(proxy.createdAt) }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex items-center justify-end gap-1 whitespace-nowrap">
                    <UTooltip text="Edit" :disabled="wideActions">
                      <UButton
                        label="Edit"
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="outline"
                        size="xs"
                        :ui="ACTION_LABEL_UI"
                        aria-label="Edit"
                        data-testid="px-edit"
                        @click="openEdit(proxy)"
                      />
                    </UTooltip>
                    <UTooltip text="Check" :disabled="wideActions">
                      <UButton
                        label="Check"
                        icon="i-lucide-plug-zap"
                        color="neutral"
                        variant="outline"
                        size="xs"
                        :ui="ACTION_LABEL_UI"
                        aria-label="Check"
                        :loading="checking.has(proxy.id)"
                        :disabled="checkingAll && !checking.has(proxy.id)"
                        data-testid="px-check"
                        @click="checkOne(proxy)"
                      />
                    </UTooltip>
                    <UTooltip text="Delete" :disabled="wideActions">
                      <UButton
                        label="Delete"
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="subtle"
                        size="xs"
                        :ui="ACTION_LABEL_UI"
                        aria-label="Delete"
                        data-testid="px-delete"
                        @click="askDelete(proxy)"
                      />
                    </UTooltip>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="!error"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
        >
          <span data-testid="px-count">{{ total }} proxies</span>

          <UPagination
            v-if="total > LIMIT"
            :page="page"
            :items-per-page="LIMIT"
            :total="total"
            data-testid="px-pagination"
            @update:page="(p: number) => page = p"
          />
        </div>
      </div>

      <ProxiesFormModal
        v-model:open="formOpen"
        :proxy="formTarget"
        @created="onCreated"
        @updated="onUpdated"
      />
      <ProxiesBatchModal
        v-model:open="batchOpen"
        @imported="onImported"
      />
      <ProxiesDeleteModal
        v-model:open="deleteOpen"
        :proxy="deleteTarget"
        @deleted="onDeleted"
      />
    </template>
  </UDashboardPanel>
</template>
