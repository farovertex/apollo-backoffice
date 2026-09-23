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
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { DeleteProxyResponse, ProxiesResponse, Proxy } from '#shared/types/proxies'

useSeoMeta({ title: 'Proxies' })

const LIMIT = 20
const DEBOUNCE_MS = 300

const api = useApi()

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
</script>

<template>
  <UDashboardPanel id="proxies">
    <template #header>
      <UDashboardNavbar title="Proxies">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <!-- two labelled buttons clip the H1 (`truncate`) at 390 px → icon-only below `sm`, aria-label keeps the name -->
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
          title="No proxy matches your search"
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
                  Created
                </th>
                <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody :class="pending ? 'opacity-60' : ''">
              <tr v-if="pending && items.length === 0" data-testid="px-loading">
                <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="9">
                  Loading proxies…
                </td>
              </tr>
              <tr
                v-for="proxy in items"
                :key="proxy.id"
                :data-id="proxy.id"
                data-testid="px-row"
              >
                <td class="border-b border-default px-3 py-2">
                  <span class="font-medium text-highlighted" data-testid="px-label">{{ proxy.label }}</span>
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
      <ProxiesDeleteModal
        v-model:open="deleteOpen"
        :proxy="deleteTarget"
        @deleted="onDeleted"
      />
    </template>
  </UDashboardPanel>
</template>
