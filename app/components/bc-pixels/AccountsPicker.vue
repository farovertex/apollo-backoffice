<script setup lang="ts">
/**
 * FEAT-102 — the account picker of step 4 (`bpx-accounts`; spec "UI behaviour → Panel" 4, AC-25; api-contract §3.9, §7.4).
 * Reads `GET /bc-pixels/:id/accounts` (page 1 when it mounts, again on every debounced search / filter change, the next
 * page on `bpx-accounts-more` — rows accumulate). Nothing is ticked by default (A1); a linked row cannot be ticked, carries
 * the "ผูกแล้ว" badge and a `bpx-unlink-<id>` button. "เลือกทั้งหมดที่ยังไม่ผูก" ticks every not-linked row of the loaded
 * pages. The ticks survive a search / filter change (they are ids). The picker sends nothing itself: `link` / `unlink`
 * go to the step, which owns the POST, the confirm dialog and the job card.
 */
import type { PixelAccountRow, PixelAccountsResponse } from '#shared/types/bc-pixels'

const props = defineProps<{
  pixelId: string
  /** superseded pixel: only unlink stays enabled */
  superseded: boolean
  /** a link / unlink POST is in flight */
  posting: boolean
  /** the last refusal of a link / unlink POST (the API's text) */
  error: string | null
}>()

const emit = defineEmits<{
  link: [ids: string[]]
  unlink: [row: PixelAccountRow]
  close: []
}>()

const api = useApi()

type LinkedFilter = 'all' | 'true' | 'false'
const FILTER_ITEMS: { label: string, value: LinkedFilter }[] = [
  { label: 'ทั้งหมด', value: 'all' },
  { label: 'ผูกแล้ว', value: 'true' },
  { label: 'ยังไม่ผูก', value: 'false' }
]

const search = ref('')
const searchDebounced = refDebounced(search, 300)
const filter = ref<LinkedFilter>('all')

const rows = ref<PixelAccountRow[]>([])
const page = ref(1)
const total = ref(0)
const linkedTotal = ref<number | null>(null)
const advertiserTotal = ref<number | null>(null)
const loading = ref(false)
const loaded = ref(false)
const loadError = ref<string | null>(null)
let seq = 0

const selected = ref<Set<string>>(new Set())

async function load(nextPage: number) {
  const s = ++seq
  loading.value = true
  loadError.value = null
  const query: Record<string, string | number> = { page: nextPage, limit: BC_PIXEL_ACCOUNTS_LIMIT }
  const q = searchDebounced.value.trim()
  if (q) query.search = q
  if (filter.value !== 'all') query.linked = filter.value
  try {
    const res = await api<PixelAccountsResponse>(`/bc-pixels/${encodeURIComponent(props.pixelId)}/accounts`, { query, retry: 0 })
    if (s !== seq) return
    const list = res.accounts ?? []
    rows.value = nextPage === 1 ? list : [...rows.value, ...list.filter(a => !rows.value.some(r => r.advertiserId === a.advertiserId))]
    page.value = res.page ?? nextPage
    total.value = res.total ?? rows.value.length
    linkedTotal.value = res.linkedTotal ?? null
    advertiserTotal.value = res.advertiserTotal ?? null
    loaded.value = true
  } catch (e) {
    if (s !== seq) return
    loadError.value = bcPixelFailure(e, 'โหลดรายการบัญชีไม่สำเร็จ').message
  } finally {
    if (s === seq) loading.value = false
  }
}

watch([searchDebounced, filter], () => {
  void load(1)
})
onMounted(() => {
  void load(1)
})
onUnmounted(() => {
  seq++
})

/** re-read from page 1 (after a refusal that says the list is stale) */
function reload() {
  void load(1)
}
defineExpose({ reload })

const hasMore = computed(() => loaded.value && rows.value.length < total.value)

function isChecked(id: string): boolean {
  return selected.value.has(id)
}
function toggle(row: PixelAccountRow, value: boolean | 'indeterminate') {
  if (row.linked) return
  const next = new Set(selected.value)
  if (value === true) next.add(row.advertiserId)
  else next.delete(row.advertiserId)
  selected.value = next
}
function selectUnlinked() {
  const next = new Set(selected.value)
  for (const r of rows.value) if (!r.linked) next.add(r.advertiserId)
  selected.value = next
}
function clearSelection() {
  selected.value = new Set()
}

const count = computed(() => selected.value.size)
const tooMany = computed(() => count.value > BC_PIXEL_LINK_MAX)
const unlinkedLoaded = computed(() => rows.value.filter(r => !r.linked).length)

const submitDisabled = computed(() =>
  props.superseded || props.posting || count.value === 0 || tooMany.value
)

function submit() {
  if (submitDisabled.value) return
  emit('link', [...selected.value])
}
</script>

<template>
  <div class="space-y-2 rounded-md border border-default p-2.5 sm:p-3" data-testid="bpx-accounts">
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <UInput
        v-model="search"
        icon="i-lucide-search"
        placeholder="ค้นหาชื่อหรือ ID บัญชีโฆษณา"
        size="sm"
        class="min-w-0 flex-1"
        aria-label="ค้นหาบัญชีโฆษณา"
        data-testid="bpx-accounts-search"
      />
      <USelect
        v-model="filter"
        :items="FILTER_ITEMS"
        size="sm"
        class="w-full sm:w-32"
        aria-label="กรองสถานะการผูก"
        data-testid="bpx-accounts-filter"
      />
    </div>

    <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
      <span>
        <template v-if="advertiserTotal !== null">ผูกแล้ว {{ linkedTotal ?? 0 }} / {{ advertiserTotal }} · </template>
        เลือก {{ count }} บัญชี
      </span>
      <span class="flex flex-wrap items-center gap-1">
        <UButton
          v-if="count > 0"
          label="ล้างที่เลือก"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="clearSelection"
        />
        <UButton
          :label="BC_PIXEL_TEXT.selectUnlinked"
          icon="i-lucide-list-checks"
          color="neutral"
          variant="outline"
          size="xs"
          :disabled="superseded || posting || unlinkedLoaded === 0"
          data-testid="bpx-accounts-select-unlinked"
          @click="selectUnlinked"
        />
      </span>
    </div>

    <div v-if="loading && !loaded" class="space-y-1.5">
      <USkeleton v-for="i in 4" :key="i" class="h-11 w-full" />
    </div>

    <div
      v-else-if="loadError && !loaded"
      class="flex flex-wrap items-center gap-2 rounded-md bg-error/10 px-2 py-1.5 text-xs text-error"
      role="alert"
    >
      <span class="min-w-0 flex-1 break-words">{{ loadError }}</span>
      <UButton
        label="ลองใหม่"
        color="error"
        variant="soft"
        size="xs"
        @click="reload"
      />
    </div>

    <p
      v-else-if="loaded && rows.length === 0"
      class="rounded-md bg-elevated px-2 py-3 text-center text-xs text-muted"
    >
      {{ searchDebounced.trim() || filter !== 'all' ? 'ไม่พบบัญชีที่ตรงกับเงื่อนไข' : 'BC นี้ยังไม่มีบัญชีโฆษณา' }}
    </p>

    <ul
      v-else
      class="max-h-80 divide-y divide-default overflow-y-auto rounded-md border border-default"
      :class="{ 'opacity-60': loading }"
    >
      <li
        v-for="a in rows"
        :key="a.advertiserId"
        class="flex items-center gap-2 px-2 py-2"
        :data-testid="`bpx-account-${a.advertiserId}`"
        :data-linked="a.linked ? 'true' : 'false'"
      >
        <UCheckbox
          :model-value="isChecked(a.advertiserId)"
          :disabled="a.linked || superseded || posting"
          :aria-label="`เลือก ${a.name}`"
          :data-testid="`bpx-account-check-${a.advertiserId}`"
          @update:model-value="toggle(a, $event)"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-highlighted" :title="a.name">
            {{ a.name || '—' }}
          </p>
          <p class="truncate text-xs text-muted">
            <span class="font-mono">{{ a.advertiserId }}</span>
            <template v-if="a.status">
              · {{ a.status }}
            </template>
          </p>
        </div>
        <template v-if="a.linked">
          <UBadge
            color="success"
            variant="subtle"
            size="sm"
            class="shrink-0 whitespace-nowrap"
          >
            {{ BC_PIXEL_TEXT.linkedBadge }}
          </UBadge>
          <UButton
            :label="BC_PIXEL_TEXT.unlink"
            color="error"
            variant="ghost"
            size="xs"
            class="shrink-0"
            :disabled="posting"
            :data-testid="`bpx-unlink-${a.advertiserId}`"
            @click="emit('unlink', a)"
          />
        </template>
      </li>
    </ul>

    <p v-if="loadError && loaded" class="text-xs text-error" role="alert">
      {{ loadError }}
    </p>

    <div v-if="hasMore" class="flex justify-center">
      <UButton
        :label="`โหลดเพิ่ม (${rows.length} / ${total})`"
        icon="i-lucide-chevrons-down"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="loading"
        data-testid="bpx-accounts-more"
        @click="load(page + 1)"
      />
    </div>

    <p v-if="tooMany" class="text-xs text-error">
      เลือกได้ไม่เกิน {{ BC_PIXEL_LINK_MAX }} บัญชีต่อครั้ง
    </p>
    <p
      v-if="error"
      class="rounded-md bg-error/10 px-2 py-1.5 text-xs break-words text-error"
      role="alert"
      data-testid="bpx-link-error"
    >
      {{ error }}
    </p>

    <div class="flex flex-wrap justify-end gap-2 pt-1">
      <UButton
        label="ปิด"
        color="neutral"
        variant="outline"
        size="sm"
        :disabled="posting"
        data-testid="bpx-link-cancel"
        @click="emit('close')"
      />
      <UButton
        :label="`ผูก ${count} บัญชี`"
        icon="i-lucide-link"
        color="primary"
        size="sm"
        :loading="posting"
        :disabled="submitDisabled"
        data-testid="bpx-link-submit"
        @click="submit"
      />
    </div>
  </div>
</template>
