<script setup lang="ts">
/**
 * FEAT-009 — Manage which workspaces are shared to an admin (api-contract.md v1
 * `GET /admins/:id/workspaces`, `POST /workspaces/:id/share`, `DELETE /workspaces/:id/share/:adminId`).
 *
 * One `GET` per open (and one after every share / revoke); the admin's own home workspace (`level: 'owner'`) is
 * never listed — membership only, this modal never offers or implies an ownership change.
 *   level 'member'                      → Revoke
 *   level null   + status 'active'      → Share
 *   level null   + status 'archived'    → no button, `adm-ws-archived` hint
 * After each action the page is told to re-request `GET /backend/admins` too (the Shared count changes).
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdminListItem,
  AdminWorkspaceRow,
  AdminWorkspacesResponse,
  ShareWorkspaceBody
} from '#shared/types/admins'

const props = defineProps<{
  admin: AdminListItem | null
}>()

const emit = defineEmits<{
  /** a grant changed — the page re-requests the admin list */
  changed: []
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'adm-workspaces-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const rows = ref<AdminWorkspaceRow[]>([])
const pending = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const search = ref('')
/** id of the workspace whose share/revoke request is in flight */
const busyId = ref<string | null>(null)
// bumped on every request so a late response from a superseded load is dropped
let session = 0

async function load() {
  const admin = props.admin
  if (!admin) return
  const s = ++session
  pending.value = true
  error.value = null
  try {
    // retry: 0 — exactly one GET per open / refresh
    const res = await api<AdminWorkspacesResponse>(`/admins/${encodeURIComponent(admin.id)}/workspaces`, { retry: 0 })
    if (s !== session) return
    // the admin's own workspace is not a membership — it is never listed
    rows.value = (res.workspaces ?? []).filter(row => row.level !== 'owner')
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

watch(open, (isOpen) => {
  if (!isOpen) {
    // a late response must not land in the next opening
    session++
    return
  }
  rows.value = []
  loaded.value = false
  error.value = null
  search.value = ''
  busyId.value = null
  void load()
})

const filtered = computed(() => {
  const needle = search.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter(row => row.name.toLowerCase().includes(needle))
})

const isLoading = computed(() => pending.value && rows.value.length === 0)
const isEmpty = computed(() => loaded.value && !error.value && rows.value.length === 0)

function apiMessage(e: unknown, fallback: string): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  return err.data?.error ?? err.message ?? fallback
}

async function share(row: AdminWorkspaceRow) {
  const admin = props.admin
  if (!admin || busyId.value) return
  busyId.value = row.id
  const body: ShareWorkspaceBody = { adminId: admin.id }
  try {
    // retry: 0 — exactly one POST per click
    await api(`/workspaces/${encodeURIComponent(row.id)}/share`, { method: 'POST', body, retry: 0 })
    toast.add({ title: 'Workspace shared', description: row.name, color: 'success' })
    await load()
    emit('changed')
  } catch (e) {
    toast.add({
      title: 'Could not share the workspace',
      description: apiMessage(e, 'Unexpected error'),
      color: 'error'
    })
  } finally {
    busyId.value = null
  }
}

async function revoke(row: AdminWorkspaceRow) {
  const admin = props.admin
  if (!admin || busyId.value) return
  busyId.value = row.id
  try {
    // retry: 0 — exactly one DELETE per click
    await api(
      `/workspaces/${encodeURIComponent(row.id)}/share/${encodeURIComponent(admin.id)}`,
      { method: 'DELETE', retry: 0 }
    )
    toast.add({ title: 'Access revoked', description: row.name, color: 'success' })
    await load()
    emit('changed')
  } catch (e) {
    toast.add({
      title: 'Could not revoke the access',
      description: apiMessage(e, 'Unexpected error'),
      color: 'error'
    })
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Manage workspaces"
    :description="admin ? `Workspaces shared with ${admin.username}` : undefined"
    :ui="{ content: 'max-w-2xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search workspace name"
          class="w-full sm:max-w-xs"
          data-testid="adm-ws-search"
        />

        <div
          v-if="isLoading"
          class="px-3 py-6 text-center text-sm text-muted"
          data-testid="adm-ws-loading"
        >
          Loading workspaces…
        </div>

        <UAlert
          v-else-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load the workspaces"
          :description="error"
          role="alert"
          data-testid="adm-ws-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              size="xs"
              :loading="pending"
              data-testid="adm-ws-retry"
              @click="load()"
            />
          </template>
        </UAlert>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-folder-open"
          title="No other workspace"
          description="There is no workspace besides this admin's own one."
          data-testid="adm-ws-empty"
        />

        <div v-else class="overflow-x-auto" data-testid="adm-ws-table">
          <table class="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr class="bg-elevated/50">
                <th class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Name
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Owner
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Status
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Access
                </th>
                <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Action
                </th>
              </tr>
            </thead>
            <tbody :class="pending ? 'opacity-60' : ''">
              <tr
                v-for="row in filtered"
                :key="row.id"
                :data-id="row.id"
                data-slot="tr"
                data-testid="adm-ws-row"
              >
                <td class="border-b border-default px-3 py-2">
                  <span class="font-medium text-highlighted" data-testid="adm-ws-name">{{ row.name }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" data-testid="adm-ws-owner">
                    {{ row.owner ? `${row.owner.displayName} @${row.owner.username}` : '—' }}
                  </span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    :color="row.status === 'active' ? 'success' : 'neutral'"
                    variant="subtle"
                    class="capitalize"
                    data-testid="adm-ws-status"
                  >
                    {{ row.status }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    v-if="row.level === 'member'"
                    color="primary"
                    variant="subtle"
                    data-testid="adm-ws-level"
                  >
                    Member
                  </UBadge>
                  <span v-else class="text-muted" data-testid="adm-ws-level">—</span>
                </td>
                <td class="border-b border-default px-3 py-2 text-right">
                  <UButton
                    v-if="row.level === 'member'"
                    label="Revoke"
                    icon="i-lucide-user-minus"
                    color="error"
                    variant="subtle"
                    size="xs"
                    :loading="busyId === row.id"
                    :disabled="busyId !== null && busyId !== row.id"
                    data-testid="adm-ws-revoke"
                    @click="revoke(row)"
                  />
                  <UButton
                    v-else-if="row.status === 'active'"
                    label="Share"
                    icon="i-lucide-user-plus"
                    color="primary"
                    variant="subtle"
                    size="xs"
                    :loading="busyId === row.id"
                    :disabled="busyId !== null && busyId !== row.id"
                    data-testid="adm-ws-share"
                    @click="share(row)"
                  />
                  <span v-else class="text-xs text-muted" data-testid="adm-ws-archived">
                    Archived — cannot be shared
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end">
        <UButton
          label="Close"
          color="neutral"
          variant="subtle"
          data-testid="adm-ws-close"
          @click="open = false"
        />
      </div>
    </template>
  </UModal>
</template>
