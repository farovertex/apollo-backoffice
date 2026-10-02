<script setup lang="ts">
/**
 * FEAT-009 — Admin Management (functions 0.2 / 0.3 / 0.4 / 0.5 + soft delete; api-contract.md v1).
 *
 * GOD only: `middleware/god-only.ts` sends everybody else home with a flash toast, the sidebar item is hidden,
 * and the API keeps `@Roles('GOD')` as the authority.
 *
 * Exactly one `GET /backend/admins` per mount / Refresh / after every mutation; the only server-side parameter is
 * `includeDeleted=true`, driven by the Show deleted switch (toggling re-requests). Search, role filter, status
 * filter and sorting run in the browser on the returned rows (< 200 admins, human decision) through the pure
 * `filterSortAdmins()` in `app/utils/admins.ts`, so a later server-side version replaces the call site only.
 *
 * The table is plain markup (not `UTable`) so every `<tr>` can carry `data-id` + `data-status`.
 */
import { formatTimeAgo } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { AdminRole, ApiErrorBody } from '#shared/types/auth'
import type { AdminListItem, AdminStatus, AdminsResponse } from '#shared/types/admins'

definePageMeta({ middleware: 'god-only' })

useSeoMeta({ title: 'Admin Management' })

const DEBOUNCE_MS = 300

const api = useApi()
const auth = useAuth()

const currentAdminId = computed(() => auth.admin.value?.id ?? null)

// ── list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const rows = ref<AdminListItem[]>([])
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const showDeleted = ref(false)
// bumped on every request so a late response from a superseded query is dropped
let session = 0

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  try {
    // retry: 0 — exactly one request per load, ofetch must not re-issue it on 5xx
    const res = await api<AdminsResponse>('/admins', {
      retry: 0,
      // no query at all while the switch is off — AC-1 asserts the bare `GET /backend/admins`
      query: showDeleted.value ? { includeDeleted: 'true' } : undefined
    })
    if (s !== session) return
    rows.value = res.admins ?? []
    loaded.value = true
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    rows.value = []
    error.value = err.data?.error ?? err.message ?? 'Unexpected error'
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

// ── toolbar (client-side only — none of these issues a request) ──────────────────────────────────────────────────────
const search = ref('')
const searchDebounced = refDebounced(search, DEBOUNCE_MS)
const roleFilter = ref<AdminRoleFilter>(ALL)
const statusFilter = ref<AdminStatusFilter>(ALL)
const sort = ref<AdminSort>({ ...ADMIN_DEFAULT_SORT })

const roleItems = computed(() => [
  { label: 'All roles', value: ALL },
  ...ADMIN_ROLES.map(role => ({ label: role, value: role }))
])

const STATUS_LABELS: Record<AdminStatus, string> = {
  active: 'Active',
  banned: 'Banned',
  deleted: 'Deleted'
}

// Deleted is only offered while the Show deleted switch is on — there is no such row otherwise
const statusItems = computed(() => [
  { label: 'All statuses', value: ALL },
  ...ADMIN_STATUSES
    .filter(status => status !== 'deleted' || showDeleted.value)
    .map(status => ({ label: STATUS_LABELS[status], value: status }))
])

// the switch changes the request, not the client-side filter
watch(showDeleted, () => {
  if (!showDeleted.value && statusFilter.value === 'deleted') statusFilter.value = ALL
  void load()
})

const query = computed<AdminListQuery>(() => ({
  search: searchDebounced.value,
  role: roleFilter.value,
  status: statusFilter.value,
  sort: sort.value
}))

const visible = computed(() => filterSortAdmins(rows.value, query.value))
const filterActive = computed(() => hasAdminFilter(query.value))
const countLabel = computed(() => adminCountLabel(visible.value.length, rows.value.length, filterActive.value))

function toggleSort(key: AdminSortKey) {
  sort.value = nextAdminSort(sort.value, key)
}

function sortIcon(key: AdminSortKey): string {
  if (sort.value.key !== key) return 'i-lucide-chevrons-up-down'
  return sort.value.direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
}

function clearSearch() {
  search.value = ''
}

function clearFilters() {
  search.value = ''
  roleFilter.value = ALL
  statusFilter.value = ALL
}

// ── states ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const isLoading = computed(() => pending.value && rows.value.length === 0)
const isEmpty = computed(() => loaded.value && !error.value && rows.value.length === 0)
const isNoMatch = computed(() => loaded.value && !error.value && rows.value.length > 0 && visible.value.length === 0)
const showTable = computed(() => !error.value && !isEmpty.value && !isNoMatch.value)

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const now = useNow({ interval: 30_000 })

function timeAgo(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}

/** deterministic local date (`YYYY-MM-DD`) — never locale-dependent */
function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const ROLE_COLORS: Record<AdminRole, 'primary' | 'neutral' | 'warning'> = {
  GOD: 'primary',
  Admin: 'neutral',
  Payment: 'warning'
}

const STATUS_COLORS: Record<AdminStatus, 'success' | 'error' | 'neutral'> = {
  active: 'success',
  banned: 'error',
  deleted: 'neutral'
}

function isSelf(admin: AdminListItem): boolean {
  return currentAdminId.value !== null && admin.id === currentAdminId.value
}

// ── modals ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const formOpen = ref(false)
const formTarget = ref<AdminListItem | null>(null)
const resetOpen = ref(false)
const banOpen = ref(false)
const workspacesOpen = ref(false)
const deleteOpen = ref(false)
const actionTarget = ref<AdminListItem | null>(null)

function openCreate() {
  formTarget.value = null
  formOpen.value = true
}

function openEdit(admin: AdminListItem) {
  formTarget.value = admin
  formOpen.value = true
}

function openFor(admin: AdminListItem, modal: Ref<boolean>) {
  actionTarget.value = admin
  modal.value = true
}

/** a dropdown item plus the `data-testid` the `#item` slot puts on its label (item objects are not bound to the DOM) */
type AdminAction = DropdownMenuItem & { testid: string }

function actionsFor(admin: AdminListItem): AdminAction[] {
  const self = isSelf(admin)
  const items: AdminAction[] = [{
    label: 'Edit',
    icon: 'i-lucide-pencil',
    testid: 'adm-action-edit',
    onSelect: () => openEdit(admin)
  }, {
    label: 'Reset password',
    icon: 'i-lucide-key-round',
    testid: 'adm-action-reset',
    onSelect: () => openFor(admin, resetOpen)
  }]

  // self-protection mirrors the API 409s: a GOD can neither ban nor delete themself
  if (!self) {
    items.push({
      label: admin.status === 'banned' ? 'Unban' : 'Ban',
      icon: admin.status === 'banned' ? 'i-lucide-circle-check' : 'i-lucide-ban',
      testid: 'adm-action-ban',
      onSelect: () => openFor(admin, banOpen)
    })
  }

  items.push({
    label: 'Manage workspaces',
    icon: 'i-lucide-folder-cog',
    testid: 'adm-action-workspaces',
    onSelect: () => openFor(admin, workspacesOpen)
  })

  if (!self) {
    items.push({
      label: 'Delete',
      icon: 'i-lucide-trash-2',
      color: 'error',
      testid: 'adm-action-delete',
      onSelect: () => openFor(admin, deleteOpen)
    })
  }

  return items
}

/** every mutation ends with exactly one list re-request */
function reload() {
  void load()
}
</script>

<template>
  <UDashboardPanel id="admins">
    <template #header>
      <UDashboardNavbar title="Admin Management">
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
            data-testid="adm-refresh"
            @click="load()"
          />
          <UButton
            label="Create admin"
            aria-label="Create admin"
            icon="i-lucide-plus"
            color="primary"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="adm-create"
            @click="openCreate"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div data-testid="adm-page" :data-pending="pending ? 'true' : 'false'" class="flex min-w-0 flex-1 flex-col gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <UInput
            v-model="search"
            class="w-full sm:max-w-xs"
            icon="i-lucide-search"
            placeholder="Search username or display name"
            data-testid="adm-search"
          >
            <template v-if="search !== ''" #trailing>
              <UButton
                icon="i-lucide-x"
                aria-label="Clear search"
                color="neutral"
                variant="link"
                size="xs"
                data-testid="adm-clear-search"
                @click="clearSearch"
              />
            </template>
          </UInput>

          <USelect
            v-model="roleFilter"
            :items="roleItems"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="min-w-36"
            aria-label="Filter by role"
            data-testid="adm-filter-role"
          />
          <USelect
            v-model="statusFilter"
            :items="statusItems"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="min-w-36"
            aria-label="Filter by status"
            data-testid="adm-filter-status"
          />

          <USwitch
            v-model="showDeleted"
            label="Show deleted"
            :disabled="pending"
            data-testid="adm-show-deleted"
          />

          <span class="ms-auto text-sm text-muted" data-testid="adm-count">{{ countLabel }}</span>
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load the admins"
          :description="error"
          role="alert"
          data-testid="adm-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="pending"
              data-testid="adm-retry"
              @click="load()"
            />
          </template>
        </UAlert>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-shield-check"
          title="No admins found"
          description="Create the first admin of this system"
          data-testid="adm-empty"
        >
          <template #actions>
            <UButton
              label="Create admin"
              icon="i-lucide-plus"
              color="primary"
              data-testid="adm-empty-create"
              @click="openCreate"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="isNoMatch"
          icon="i-lucide-search-x"
          title="No admins match your filters"
          data-testid="adm-no-match"
        >
          <template #actions>
            <UButton
              label="Clear filters"
              icon="i-lucide-x"
              color="neutral"
              variant="outline"
              data-testid="adm-clear-filters"
              @click="clearFilters"
            />
          </template>
        </UEmpty>

        <!-- the table scrolls inside this box; the page itself never scrolls horizontally -->
        <div v-if="showTable" class="min-w-0 overflow-x-auto" data-testid="adm-table">
          <table class="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr class="bg-elevated/50">
                <th
                  scope="col"
                  :aria-sort="ariaSortOf(sort, 'username')"
                  class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
                >
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1"
                    data-testid="adm-sort-username"
                    @click="toggleSort('username')"
                  >
                    Username <UIcon :name="sortIcon('username')" class="size-3.5 text-dimmed" />
                  </button>
                </th>
                <th
                  scope="col"
                  :aria-sort="ariaSortOf(sort, 'displayName')"
                  class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
                >
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1"
                    data-testid="adm-sort-display-name"
                    @click="toggleSort('displayName')"
                  >
                    Display Name <UIcon :name="sortIcon('displayName')" class="size-3.5 text-dimmed" />
                  </button>
                </th>
                <th
                  scope="col"
                  class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
                >
                  Roles
                </th>
                <th
                  scope="col"
                  :aria-sort="ariaSortOf(sort, 'status')"
                  class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
                >
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1"
                    data-testid="adm-sort-status"
                    @click="toggleSort('status')"
                  >
                    Status <UIcon :name="sortIcon('status')" class="size-3.5 text-dimmed" />
                  </button>
                </th>
                <th
                  scope="col"
                  :aria-sort="ariaSortOf(sort, 'homeWorkspace')"
                  class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
                >
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1"
                    data-testid="adm-sort-home-workspace"
                    @click="toggleSort('homeWorkspace')"
                  >
                    Home Workspace <UIcon :name="sortIcon('homeWorkspace')" class="size-3.5 text-dimmed" />
                  </button>
                </th>
                <th
                  scope="col"
                  :aria-sort="ariaSortOf(sort, 'sharedWorkspaceCount')"
                  class="border-y border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted"
                >
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1"
                    data-testid="adm-sort-shared"
                    @click="toggleSort('sharedWorkspaceCount')"
                  >
                    Shared <UIcon :name="sortIcon('sharedWorkspaceCount')" class="size-3.5 text-dimmed" />
                  </button>
                </th>
                <th
                  scope="col"
                  :aria-sort="ariaSortOf(sort, 'lastLoginAt')"
                  class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
                >
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1"
                    data-testid="adm-sort-last-login"
                    @click="toggleSort('lastLoginAt')"
                  >
                    Last Login <UIcon :name="sortIcon('lastLoginAt')" class="size-3.5 text-dimmed" />
                  </button>
                </th>
                <th
                  scope="col"
                  :aria-sort="ariaSortOf(sort, 'createdAt')"
                  class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
                >
                  <button
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1"
                    data-testid="adm-sort-created"
                    @click="toggleSort('createdAt')"
                  >
                    Created At <UIcon :name="sortIcon('createdAt')" class="size-3.5 text-dimmed" />
                  </button>
                </th>
                <th
                  scope="col"
                  class="rounded-r-lg border-y border-r border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody :class="pending ? 'opacity-60' : ''">
              <tr v-if="isLoading" data-testid="adm-loading">
                <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="9">
                  Loading admins…
                </td>
              </tr>
              <!-- `data-slot="tr"` mirrors UTable's rows so a row locator works the same on every table of the BO -->
              <tr
                v-for="admin in visible"
                :key="admin.id"
                :data-id="admin.id"
                :data-status="admin.status"
                data-slot="tr"
                data-testid="adm-row"
                :class="admin.status === 'deleted' ? 'opacity-60' : ''"
              >
                <td class="border-b border-default px-3 py-2">
                  <div class="flex items-center gap-2 whitespace-nowrap">
                    <span class="font-mono text-highlighted" data-testid="adm-cell-username">{{ admin.username }}</span>
                    <UBadge
                      v-if="isSelf(admin)"
                      color="primary"
                      variant="subtle"
                      size="sm"
                      data-testid="adm-you"
                    >
                      You
                    </UBadge>
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span data-testid="adm-cell-display-name">{{ admin.displayName }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex flex-wrap items-center gap-1" data-testid="adm-cell-roles">
                    <UBadge
                      v-for="role in admin.roles"
                      :key="role"
                      :color="ROLE_COLORS[role]"
                      variant="subtle"
                      data-testid="adm-role-badge"
                    >
                      {{ role }}
                    </UBadge>
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    :color="STATUS_COLORS[admin.status]"
                    variant="subtle"
                    data-testid="adm-cell-status"
                  >
                    {{ STATUS_LABELS[admin.status] }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" data-testid="adm-cell-home-workspace">{{ admin.homeWorkspace?.name ?? '—' }}</span>
                </td>
                <td class="border-b border-default px-3 py-2 text-right tabular-nums">
                  <span data-testid="adm-cell-shared">{{ admin.sharedWorkspaceCount }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span
                    class="whitespace-nowrap"
                    :title="admin.lastLoginAt ?? undefined"
                    data-testid="adm-cell-last-login"
                  >{{ timeAgo(admin.lastLoginAt) }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span
                    class="whitespace-nowrap"
                    :title="admin.createdAt"
                    data-testid="adm-cell-created"
                  >{{ shortDate(admin.createdAt) }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex justify-end">
                    <UDropdownMenu :items="actionsFor(admin)" :content="{ align: 'end' }">
                      <UButton
                        icon="i-lucide-ellipsis-vertical"
                        color="neutral"
                        variant="ghost"
                        size="xs"
                        :aria-label="`Actions for ${admin.username}`"
                        :disabled="admin.status === 'deleted'"
                        :aria-disabled="admin.status === 'deleted' ? 'true' : undefined"
                        data-testid="adm-actions"
                      />

                      <template #item="{ item }">
                        <UIcon v-if="item.icon" :name="item.icon" class="size-4 shrink-0" />
                        <span class="truncate" :data-testid="item.testid">{{ item.label }}</span>
                      </template>
                    </UDropdownMenu>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <AdminsFormModal
        v-model:open="formOpen"
        :admin="formTarget"
        :current-admin-id="currentAdminId"
        @created="reload"
        @updated="reload"
      />
      <AdminsResetPasswordModal
        v-model:open="resetOpen"
        :admin="actionTarget"
      />
      <AdminsBanModal
        v-model:open="banOpen"
        :admin="actionTarget"
        @done="reload"
      />
      <AdminsWorkspacesModal
        v-model:open="workspacesOpen"
        :admin="actionTarget"
        @changed="reload"
      />
      <AdminsDeleteModal
        v-model:open="deleteOpen"
        :admin="actionTarget"
        @deleted="reload"
      />
    </template>
  </UDashboardPanel>
</template>
