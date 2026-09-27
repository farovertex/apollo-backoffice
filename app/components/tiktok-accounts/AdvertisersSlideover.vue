<script setup lang="ts">
/**
 * FEAT-005 — advertisers of one TikTok account (functions 3.9, spec.md "UI behaviour", api-contract.md v1 §5/§7).
 * Opened from the Advertisers column (`ta-adv-count`). While open it lists
 * `GET /backend/tiktok-accounts/:id/advertisers?page=&limit=50&missing=<false|all>[&q=][&status=]` — exactly one
 * request per open / filter change (search debounced 300 ms), page reset to 1 on every filter change, "Load more"
 * appends the next page while `page * limit < total`. State is exposed as `data-state` on the dialog element
 * (`ta-adv-slideover`): loading (first page in flight, nothing shown yet) · ready · empty · error.
 * Filters reset when the slideover closes, so the next open starts from `page=1&missing=false` with one request.
 * The "Sync advertisers" button of the empty state emits `sync`; the page runs the same POST + poll as the row.
 */
import type { FetchError } from 'ofetch'
import type { SlideoverProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { Advertiser, AdvertiserMissingFilter, AdvertisersResponse, AdvertiserStatus } from '#shared/types/advertisers'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  account: TikTokAccount | null
}>()

const emit = defineEmits<{
  /** the empty state's "Sync advertisers" button — the page starts the discover job (same as the row action) */
  sync: [account: TikTokAccount]
}>()

const open = defineModel<boolean>('open', { default: false })

type ListState = 'loading' | 'ready' | 'empty' | 'error'

const LIMIT = 50
const DEBOUNCE_MS = 300
const REJECT_MAX = 60

const api = useApi()
const toast = useToast()

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const search = ref('')
const searchDebounced = refDebounced(search, DEBOUNCE_MS)
const statusFilter = ref<'all' | AdvertiserStatus>('all')
const showMissing = ref(false)

const statusItems: { label: string, value: 'all' | AdvertiserStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Unknown', value: 'unknown' }
]

const hasFilter = computed(() => search.value.trim() !== '' || statusFilter.value !== 'all' || showMissing.value)

function resetFilters() {
  search.value = ''
  statusFilter.value = 'all'
  showMissing.value = false
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const items = ref<Advertiser[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
// bumped on every close / reload so a late response from a previous request is dropped
let session = 0

const hasMore = computed(() => page.value * LIMIT < total.value)

async function load(nextPage: number, append = false) {
  const id = props.account?.id
  if (!id) return
  const s = ++session
  if (append) loadingMore.value = true
  else loading.value = true
  error.value = null
  try {
    const q = searchDebounced.value.trim()
    const missing: AdvertiserMissingFilter = showMissing.value ? 'all' : 'false'
    // retry: 0 — exactly one request per filter change / page, ofetch must not re-issue it on 5xx
    const res = await api<AdvertisersResponse>(`/tiktok-accounts/${encodeURIComponent(id)}/advertisers`, {
      retry: 0,
      query: {
        page: nextPage,
        limit: LIMIT,
        missing,
        q: q || undefined,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value
      }
    })
    if (s !== session) return
    items.value = append ? [...items.value, ...res.advertisers] : res.advertisers
    page.value = res.page
    total.value = res.total
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Could not load the advertisers'
    if (append) {
      // keep the rows already shown; the user can press "Load more" again
      toast.add({ title: 'Could not load more advertisers', description: message, color: 'error' })
    } else {
      error.value = message
    }
  } finally {
    if (s === session) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function reload() {
  void load(1)
}

function loadMore() {
  if (loadingMore.value || loading.value || !hasMore.value) return
  void load(page.value + 1, true)
}

function reset() {
  session++
  items.value = []
  page.value = 1
  total.value = 0
  loading.value = false
  loadingMore.value = false
  error.value = null
}

// one request per distinct (account, filters) while open; `null` while closed. `lastDiscoverAt` is part of the key
// so a sync that finishes while the slideover is open (empty-state button / row action) reloads the list once.
const queryKey = computed<string | null>(() =>
  open.value && props.account
    ? JSON.stringify([props.account.id, props.account.lastDiscoverAt, searchDebounced.value.trim(), statusFilter.value, showMissing.value])
    : null
)
watch(queryKey, (key) => {
  if (key) reload()
})

watch(open, (isOpen) => {
  if (!isOpen) {
    reset()
    resetFilters()
  }
})

onUnmounted(() => {
  session++
})

// ── state ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const state = computed<ListState>(() => {
  if (error.value) return 'error'
  if (loading.value) return 'loading'
  if (items.value.length === 0) return 'empty'
  return 'ready'
})

// USlideover's root is renderless: `content` is v-bound onto the DialogContent element QA locates as
// `ta-adv-slideover[data-state]` (same trick as the LoginModal).
const slideoverContent = computed(() => ({ 'data-testid': 'ta-adv-slideover', 'data-state': state.value }) as SlideoverProps['content'])

const title = computed(() => `Advertisers — ${props.account?.label ?? props.account?.loginEmail ?? ''}`)
const canSync = computed(() => {
  const a = props.account
  return !!a && a.advertiserCount === 0 && a.runningJob === null && a.sessionStatus !== 'needsHuman' && a.isActive
})
const emptyTitle = computed(() => hasFilter.value ? 'No match' : 'No advertisers yet')
const emptyDescription = computed(() =>
  hasFilter.value
    ? 'No advertiser matches the current search or filters.'
    : props.account?.advertiserCount === 0
      ? 'Press Sync advertisers to read them from the Business Center.'
      : 'Nothing to show.'
)

// ── cells ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<AdvertiserStatus, { label: string, color: 'success' | 'error' | 'neutral' }> = {
  active: { label: 'Active', color: 'success' },
  suspended: { label: 'Suspended', color: 'error' },
  unknown: { label: 'Unknown', color: 'neutral' }
}
function statusBadge(s: AdvertiserStatus) {
  return STATUS_BADGE[s] ?? { label: s, color: 'neutral' }
}

function truncateReject(text: string): string {
  return text.length > REJECT_MAX ? `${text.slice(0, REJECT_MAX).trimEnd()}…` : text
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    toast.add({ title: 'Advertiser id copied', description: id, color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy the id', description: 'Clipboard access was denied by the browser.', color: 'error' })
  }
}

function onSync() {
  if (props.account && canSync.value) emit('sync', props.account)
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :ui="{ content: 'sm:max-w-xl', body: 'flex flex-col gap-4' }"
    :content="slideoverContent"
  >
    <template #description>
      <span class="flex items-center gap-1 font-mono text-xs" data-testid="ta-adv-org">
        <UIcon name="i-lucide-building-2" class="size-3.5 shrink-0" />
        <span v-if="account?.bcOrgId" :title="account.bcOrgId">BC org {{ account.bcOrgId }}</span>
        <span v-else>No Business Center org yet</span>
      </span>
    </template>

    <template #body>
      <!-- filters -->
      <div class="flex flex-wrap items-center gap-1.5">
        <UInput
          v-model="search"
          class="w-full sm:flex-1 sm:min-w-48"
          icon="i-lucide-search"
          placeholder="Search name or id"
          data-testid="ta-adv-search"
        />
        <USelect
          v-model="statusFilter"
          :items="statusItems"
          :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
          class="min-w-32"
          aria-label="Status"
          data-testid="ta-adv-status"
        />
        <USwitch
          v-model="showMissing"
          label="Show missing"
          data-testid="ta-adv-missing"
        />
      </div>

      <!-- loading (first page) -->
      <div v-if="state === 'loading'" class="space-y-2" data-testid="ta-adv-loading">
        <USkeleton v-for="n in 6" :key="n" class="h-16 w-full" />
      </div>

      <!-- error -->
      <UAlert
        v-else-if="state === 'error'"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Could not load advertisers"
        :description="error ?? undefined"
        data-testid="ta-adv-error-state"
      >
        <template #actions>
          <UButton
            label="Retry"
            icon="i-lucide-refresh-cw"
            color="error"
            variant="solid"
            size="xs"
            :loading="loading"
            data-testid="ta-adv-retry"
            @click="reload"
          />
        </template>
      </UAlert>

      <!-- empty -->
      <UEmpty
        v-else-if="state === 'empty'"
        :icon="hasFilter ? 'i-lucide-search-x' : 'i-lucide-building-2'"
        :title="emptyTitle"
        :description="emptyDescription"
        data-testid="ta-adv-empty"
      >
        <template v-if="canSync" #actions>
          <UButton
            label="Sync advertisers"
            icon="i-lucide-refresh-cw"
            color="primary"
            data-testid="ta-adv-empty-sync"
            @click="onSync"
          />
        </template>
      </UEmpty>

      <!-- ready -->
      <template v-else>
        <ul class="divide-y divide-default rounded-lg border border-default" data-testid="ta-adv-list">
          <li
            v-for="adv in items"
            :key="adv.id"
            class="flex flex-col gap-1.5 p-3 text-sm"
            :class="adv.missingSince ? 'opacity-60' : ''"
            data-testid="ta-adv-row"
            :data-id="adv.id"
            :data-advertiser-id="adv.tiktokAdvertiserId"
            :data-status="adv.status"
            :data-missing="adv.missingSince ? 'true' : 'false'"
          >
            <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <span class="min-w-0 break-words font-medium text-highlighted" data-testid="ta-adv-name">{{ adv.name }}</span>
              <div class="flex shrink-0 flex-wrap items-center gap-1">
                <UBadge
                  v-if="adv.missingSince"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-eye-off"
                  class="whitespace-nowrap"
                  :title="adv.missingSince"
                  data-testid="ta-adv-missing-badge"
                >
                  Not seen since {{ formatDate(adv.missingSince) }}
                </UBadge>
                <UTooltip :text="accountStatusTip(adv.accountStatus)">
                  <UBadge
                    :color="statusBadge(adv.status).color"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                    data-testid="ta-adv-status-badge"
                    :data-status="adv.status"
                  >
                    {{ statusBadge(adv.status).label }}
                  </UBadge>
                </UTooltip>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span class="inline-flex items-center gap-0.5">
                <span class="font-mono" data-testid="ta-adv-id">{{ adv.tiktokAdvertiserId }}</span>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Copy advertiser id"
                  data-testid="ta-adv-id-copy"
                  @click="copyId(adv.tiktokAdvertiserId)"
                />
              </span>
              <span class="inline-flex items-center gap-1" data-testid="ta-adv-owner">
                <UIcon name="i-lucide-user-round" class="size-3.5 shrink-0" />
                {{ adv.ownerName || '—' }}
              </span>
              <UTooltip text="ad_account_type (raw)">
                <span class="inline-flex items-center gap-1" data-testid="ta-adv-type">
                  <UIcon name="i-lucide-tag" class="size-3.5 shrink-0" />
                  type {{ adv.adAccountType ?? '—' }}
                </span>
              </UTooltip>
            </div>

            <UTooltip v-if="adv.rejectReason" :text="adv.rejectReason" :ui="{ content: 'max-w-md h-auto py-2 whitespace-normal' }">
              <p
                class="flex items-start gap-1 text-xs text-error"
                :title="adv.rejectReason"
                data-testid="ta-adv-reject"
              >
                <UIcon name="i-lucide-ban" class="mt-0.5 size-3.5 shrink-0" />
                <span class="min-w-0 break-words">{{ truncateReject(adv.rejectReason) }}</span>
              </p>
            </UTooltip>
          </li>
        </ul>

        <UButton
          v-if="hasMore"
          label="Load more"
          icon="i-lucide-chevrons-down"
          color="neutral"
          variant="outline"
          class="self-center"
          :loading="loadingMore"
          data-testid="ta-adv-more"
          @click="loadMore"
        />
      </template>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3 text-sm text-muted">
        <span data-testid="ta-adv-total">{{ total }} advertisers</span>
        <UButton
          label="Close"
          color="neutral"
          variant="subtle"
          data-testid="ta-adv-close"
          @click="open = false"
        />
      </div>
    </template>
  </USlideover>
</template>
