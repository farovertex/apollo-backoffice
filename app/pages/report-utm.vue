<script setup lang="ts">
/**
 * FEAT-040 — Reports → UTM (api-contract.md v1 §2 / §3 / §5; spec U1–U5, AC-16…AC-22).
 *
 * A **separate page file** like `app/pages/report-summary.vue` (FEAT-035 F5): `app/pages/reports/utm.vue`
 * would make Nuxt treat the page as a child of `app/pages/reports.vue`, which has no `<NuxtPage>`, and
 * `/reports` would stop rendering. `definePageMeta({ path: '/reports/utm' })` gives the nested-looking URL
 * anyway; vue-router prefers the longer static path, so `/reports`, `/reports/summary` and `/reports/utm`
 * coexist.
 *
 * **The URL is the only trigger.** Unlike every other list in the BO, the filter inputs do *not* fetch while
 * you type (spec F8/U2): they are local state, "ค้นหา" (or Enter in a text field) writes the trimmed values
 * into the query with `router.replace`, and the query change issues exactly **one** `GET /reports/utm`
 * (`retry: 0`, a session counter drops the answer of a superseded query). `limit` is never sent — the API
 * default of 500 applies and the footer says "showing first M" when the API counted more (AS-7).
 *
 * Nothing is computed here: `winLose`, `costPerDeposit`, `spend`, `spendCurrency` and the whole `tfoot` come
 * from the response (`totals` is the API's, never a sum of the visible rows).
 *
 * **Refresh** posts once to `/utm/fetch`. Feature B (the `utmFetch` job) does not exist yet, so the API
 * answers 501 today — the page already implements the final contract: 202 → toast + re-read `GET
 * /reports/utm` every 5 s until `refreshedAt` moves or 2 minutes pass (the `useFetchNow` idea, AS-3, there is
 * no `GET /jobs/:id` in apollo-api); 409 / 501 / anything else → one toast with the API's own text and no
 * re-read loop.
 *
 * **export CSV** is a plain anchor at the Nitro proxy (`/backend/reports/utm.csv?…`), not a `fetch`: the
 * proxy forwards status, body and `content-type` but strips every other upstream header, so the API's
 * `content-disposition` never reaches the browser — the `download` attribute carries the file name instead.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { UtmFetchResponse, UtmReportResponse } from '#shared/types/report-utm'
import type { UtmSettings } from '#shared/types/settings'

useSeoMeta({ title: 'Reports — UTM' })
definePageMeta({ path: '/reports/utm' })

/** re-read cadence of the Refresh loop and its hard stop (AS-3) */
const REFRESH_POLL_MS = 5000
const REFRESH_MAX_MS = 120_000

const ALL_PREFIX = 'all'
const PREFIX_ALL_LABEL = '— ทุก Prefix —'

const NOTE_TEXT = 'source, medium และ campaign ต้องพิมพ์ให้ตรงทุกตัวอักษร · Spend คือค่าโฆษณาของ ads ที่ระบบสร้างจาก template ที่ผูก UTM นี้ หน่วยตามสกุลของ ad account ไม่ได้แปลงค่า · วันของ Spend ตัดตาม timezone ของ ad account (ตั้งเป็น Asia/Bangkok ทุกบัญชี) ส่วนยอดสมัครตัดเวลาไทย · "—" คือ UTM ที่ยังไม่มี ads จากระบบ'
const FORBIDDEN_TEXT = 'คุณไม่มีสิทธิ์ดูรายงานนี้'
const LOAD_FALLBACK = 'โหลดรายงานไม่สำเร็จ'
const REFRESH_FALLBACK = 'สั่งดึงยอดไม่สำเร็จ'

const route = useRoute()
const router = useRouter()
const api = useApi()
const toast = useToast()

// ── url state (the only trigger) ─────────────────────────────────────────────────────────────────────────────────────
function queryString(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value.trim() : ''
}

const from = computed(() => queryString('from'))
const to = computed(() => queryString('to'))
const prefix = computed(() => queryString('prefix'))
const source = computed(() => queryString('source'))
const medium = computed(() => queryString('medium'))
const campaign = computed(() => queryString('campaign'))

/** only the keys actually present in the URL travel to the API — never `limit` (AS-7) */
const requestQuery = computed(() => ({
  from: from.value || undefined,
  to: to.value || undefined,
  prefix: prefix.value || undefined,
  source: source.value || undefined,
  medium: medium.value || undefined,
  campaign: campaign.value || undefined
}))

const hasRowFilter = computed(() =>
  prefix.value !== '' || source.value !== '' || medium.value !== '' || campaign.value !== ''
)

// ── local inputs (typing never fetches, U2) ──────────────────────────────────────────────────────────────────────────
const fromInput = ref(from.value)
const toInput = ref(to.value)
const prefixInput = ref(prefix.value || ALL_PREFIX)
const sourceInput = ref(source.value)
const mediumInput = ref(medium.value)
const campaignInput = ref(campaign.value)

/** the URL stays the authority: a back button, a shared link or `ru-clear` re-seed the inputs */
function syncInputsFromUrl() {
  fromInput.value = from.value
  toInput.value = to.value
  prefixInput.value = prefix.value || ALL_PREFIX
  sourceInput.value = source.value
  mediumInput.value = medium.value
  campaignInput.value = campaign.value
}

function setQuery(patch: Record<string, string | undefined>) {
  const merged = { ...route.query, ...patch }
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && value !== '') next[key] = value
  }
  void router.replace({ query: next })
}

function orUndefined(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/** "ค้นหา" / Enter — the single place where a filter reaches the URL (AS-14: trimmed, empty = key removed) */
function search() {
  setQuery({
    from: orUndefined(fromInput.value),
    to: orUndefined(toInput.value),
    prefix: prefixInput.value === ALL_PREFIX ? undefined : orUndefined(prefixInput.value),
    source: orUndefined(sourceInput.value),
    medium: orUndefined(mediumInput.value),
    campaign: orUndefined(campaignInput.value)
  })
}

/** `ru-clear` — drops prefix/source/medium/campaign, keeps the dates */
function clearFilters() {
  setQuery({ prefix: undefined, source: undefined, medium: undefined, campaign: undefined })
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const report = ref<UtmReportResponse | null>(null)
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
let session = 0

async function load() {
  const s = ++session
  pending.value = true
  try {
    // retry: 0 — exactly one request per URL change / Retry / re-read tick
    const res = await api<UtmReportResponse>('/reports/utm', { retry: 0, query: requestQuery.value })
    if (s !== session) return
    report.value = res
    loaded.value = true
    error.value = null
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    // a 400 only happens through a hand-edited URL: its body is `{ error: 'validation', issues }` and the
    // first issue message is the useful one (contract §5)
    const issue = err.data?.issues?.[0]?.message
    const message = (status === 400 ? issue : undefined) ?? err.data?.error ?? err.message ?? LOAD_FALLBACK
    report.value = null
    if (status === 403) {
      forbidden.value = FORBIDDEN_TEXT
      error.value = null
    } else {
      forbidden.value = null
      error.value = message
    }
  } finally {
    if (s === session) pending.value = false
  }
}

const queryKey = computed(() => JSON.stringify([
  from.value, to.value, prefix.value, source.value, medium.value, campaign.value
]))

watch(queryKey, () => {
  syncInputsFromUrl()
  void load()
})

onMounted(() => {
  void load()
  void loadPrefixes()
})

onUnmounted(() => {
  session++
  stopWatching()
})

// ── prefix items (one GET /settings/utm on mount; a failure leaves the "all" item, AS-12) ────────────────────────────
const prefixes = ref<string[]>([])

async function loadPrefixes() {
  try {
    const res = await api<UtmSettings>('/settings/utm', { retry: 0 })
    prefixes.value = res.prefixes ?? []
  } catch {
    // no error state: the page works with the "— ทุก Prefix —" item alone
    prefixes.value = []
  }
}

const prefixItems = computed(() => [
  { label: PREFIX_ALL_LABEL, value: ALL_PREFIX },
  ...prefixes.value.map(item => ({ label: item, value: item }))
])

// ── export CSV (anchor through the Nitro proxy) ──────────────────────────────────────────────────────────────────────
/** exactly the query of the last request, in the same order, never `limit` */
const csvHref = computed(() => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(requestQuery.value)) {
    if (value) params.set(key, value)
  }
  const qs = params.toString()
  return `/backend/reports/utm.csv${qs ? `?${qs}` : ''}`
})

/** the proxy strips the API's `content-disposition`, so the file name lives on the anchor */
const csvName = computed(() => {
  const start = report.value?.from ?? from.value
  const end = report.value?.to ?? to.value
  return start && end ? `utm-${start}-${end}.csv` : 'utm.csv'
})

// ── Refresh (POST /utm/fetch + the re-read loop of AS-3) ─────────────────────────────────────────────────────────────
const refreshing = ref(false)
const watching = ref(false)
let timer: ReturnType<typeof setInterval> | null = null

function stopWatching() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  watching.value = false
}

/** re-read the report every 5 s until `refreshedAt` moved away from `before`, or 2 minutes are over */
function watchRefreshedAt(before: string | null) {
  stopWatching()
  watching.value = true
  const deadline = Date.now() + REFRESH_MAX_MS
  timer = setInterval(() => {
    if (Date.now() >= deadline) {
      stopWatching()
      return
    }
    void load().then(() => {
      if ((report.value?.refreshedAt ?? null) !== before) stopWatching()
    }).catch(() => {
      // a failed re-read is not fatal: the next tick tries again, the deadline ends the loop
    })
  }, REFRESH_POLL_MS)
}

async function refresh() {
  // one POST per click, even on a double click
  if (refreshing.value) return
  refreshing.value = true
  const before = report.value?.refreshedAt ?? null
  try {
    // retry: 0 — exactly one POST; 202 is the only success (B); today the API answers 501
    await api<UtmFetchResponse>('/utm/fetch', { method: 'POST', retry: 0 })
    toast.add({ title: 'สั่งดึงยอดแล้ว', icon: 'i-lucide-check', color: 'success' })
    watchRefreshedAt(before)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: 'Refresh ไม่สำเร็จ',
      description: err.data?.error ?? err.message ?? REFRESH_FALLBACK,
      icon: 'i-lucide-triangle-alert',
      color: (err.response?.status ?? err.statusCode) === 409 ? 'warning' : 'error'
    })
  } finally {
    refreshing.value = false
  }
}

// ── header + states ──────────────────────────────────────────────────────────────────────────────────────────────────
const intervalText = computed(() => {
  const minutes = intervalMinutes(report.value?.intervalMs ?? 300_000)
  const last = report.value?.refreshedAt ? formatClock(report.value.refreshedAt) : REPORT_DASH
  return `ยอดสมัครและฝากต่อ UTM · อัปเดตทุก ${minutes} นาที · ล่าสุด ${last} · วันตัดตามเวลาไทย`
})

const rows = computed(() => report.value?.rows ?? [])
const total = computed(() => report.value?.total ?? 0)

const showSkeleton = computed(() => pending.value && !loaded.value && !error.value && !forbidden.value)
const isEmpty = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && !hasRowFilter.value
)
const isNoMatch = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && hasRowFilter.value
)
const showTable = computed(() =>
  !showSkeleton.value && !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value && report.value !== null
)

const pageState = computed(() => {
  if (forbidden.value) return 'forbidden'
  if (error.value) return 'error'
  if (showSkeleton.value) return 'loading'
  if (isEmpty.value) return 'empty'
  if (isNoMatch.value) return 'nomatch'
  return 'ready'
})

/** "total N rows", plus "· showing first M" when the API counted more than it returned (AS-7) */
const footLabel = computed(() => {
  const shown = rows.value.length
  return total.value > shown
    ? `total ${formatInt(total.value)} rows · showing first ${formatInt(shown)}`
    : `total ${formatInt(total.value)} rows`
})

const HEADERS: { label: string, numeric: boolean }[] = [
  { label: 'DAY', numeric: false },
  { label: 'PREFIX', numeric: false },
  { label: 'SOURCE', numeric: false },
  { label: 'MEDIUM', numeric: false },
  { label: 'CAMPAIGN', numeric: false },
  { label: 'TOTAL REGISTER', numeric: true },
  { label: 'TOTAL DEPOSIT', numeric: true },
  { label: 'AMOUNT DEPOSIT', numeric: true },
  { label: 'AMOUNT WITHDRAWL', numeric: true },
  { label: 'WIN/LOSE', numeric: true },
  { label: 'SPEND', numeric: true },
  { label: 'COST PER DEPOSIT', numeric: true }
]

/** `<currency> · <n> ads` — what the spend of a row is made of */
function spendTitle(spendCurrency: string | null, adCount: number): string {
  return `${spendCurrency ?? REPORT_DASH} · ${adCount} ads`
}
</script>

<template>
  <UDashboardPanel id="report-utm">
    <template #header>
      <UDashboardNavbar title="Reports — UTM">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="refreshing || watching"
            :data-watching="watching ? 'true' : 'false'"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="ru-refresh"
            @click="refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="ru-page"
        :data-state="pageState"
        :data-pending="pending ? 'true' : 'false'"
        class="flex flex-1 flex-col gap-4"
      >
        <p class="text-sm text-muted" data-testid="ru-interval">
          {{ intervalText }}
        </p>

        <ReportsTabs />

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="forbidden"
          data-testid="ru-forbidden"
        />

        <template v-else>
          <!-- filters: local state, only "ค้นหา" writes them into the URL (U2) -->
          <div class="rounded-lg border border-default p-3" data-testid="ru-filters">
            <div class="flex flex-wrap items-center gap-2">
              <label class="flex items-center gap-1.5 text-sm text-muted">
                ตั้งแต่
                <UInput
                  v-model="fromInput"
                  type="date"
                  class="w-36"
                  aria-label="ตั้งแต่"
                  data-testid="ru-from"
                />
              </label>
              <label class="flex items-center gap-1.5 text-sm text-muted">
                ถึง
                <UInput
                  v-model="toInput"
                  type="date"
                  class="w-36"
                  aria-label="ถึง"
                  data-testid="ru-to"
                />
              </label>
              <USelect
                v-model="prefixInput"
                :items="prefixItems"
                :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
                class="min-w-36"
                aria-label="Prefix"
                data-testid="ru-prefix"
              />
              <UInput
                v-model="sourceInput"
                placeholder="source"
                class="w-28"
                aria-label="source"
                data-testid="ru-source"
                @keydown.enter="search()"
              />
              <UInput
                v-model="mediumInput"
                placeholder="medium"
                class="w-28"
                aria-label="medium"
                data-testid="ru-medium"
                @keydown.enter="search()"
              />
              <UInput
                v-model="campaignInput"
                placeholder="campaign"
                class="w-36"
                aria-label="campaign"
                data-testid="ru-campaign"
                @keydown.enter="search()"
              />
              <UButton
                label="ค้นหา"
                color="primary"
                :loading="pending"
                data-testid="ru-search"
                @click="search()"
              />
              <UButton
                label="export CSV"
                color="neutral"
                variant="outline"
                :to="csvHref"
                external
                :download="csvName"
                :disabled="pending"
                data-testid="ru-export"
              />
            </div>
            <p class="mt-3 text-xs text-muted" data-testid="ru-note">
              {{ NOTE_TEXT }}
            </p>
          </div>

          <div v-if="showSkeleton" class="flex flex-col gap-2" data-testid="ru-loading">
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-64 w-full" />
          </div>

          <UAlert
            v-else-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="ru-error"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="ru-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <UEmpty
            v-else-if="isEmpty"
            icon="i-lucide-link-2"
            title="ยังไม่มียอด — ผูก UTM ที่ ad template ก่อน"
            data-testid="ru-empty"
          />

          <UEmpty
            v-else-if="isNoMatch"
            icon="i-lucide-search-x"
            title="ไม่พบแถวที่ตรงกับตัวกรอง"
            data-testid="ru-nomatch"
          >
            <template #actions>
              <UButton
                label="ล้างตัวกรอง"
                icon="i-lucide-x"
                color="neutral"
                variant="outline"
                data-testid="ru-clear"
                @click="clearFilters()"
              />
            </template>
          </UEmpty>

          <!-- the table scrolls inside its wrapper; the page never scrolls horizontally (U3) -->
          <div
            v-else-if="showTable && report"
            class="min-w-0 overflow-x-auto rounded-lg border border-default"
            data-testid="ru-table-wrap"
          >
            <table class="w-full text-sm whitespace-nowrap" data-testid="ru-table">
              <thead>
                <tr class="border-b border-default">
                  <th
                    v-for="header in HEADERS"
                    :key="header.label"
                    scope="col"
                    class="px-3 py-2 text-xs font-medium tracking-wide text-muted"
                    :class="header.numeric ? 'text-right' : 'text-left'"
                  >
                    {{ header.label }}
                  </th>
                </tr>
              </thead>
              <tbody :class="pending ? 'opacity-60' : ''">
                <tr
                  v-for="row in rows"
                  :key="`${row.day}|${row.prefix}|${row.sourceId}|${row.mediumId}|${row.campaignId}`"
                  data-testid="ru-row"
                  :data-day="row.day"
                  :data-prefix="row.prefix"
                  :data-campaign="row.campaign"
                  class="border-b border-default/60"
                >
                  <td class="px-3 py-2">
                    {{ row.day }}
                  </td>
                  <td class="px-3 py-2">
                    {{ row.prefix }}
                  </td>
                  <td class="px-3 py-2">
                    {{ row.source }}
                  </td>
                  <td class="px-3 py-2">
                    {{ row.medium }}
                  </td>
                  <td class="px-3 py-2">
                    {{ row.campaign }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatInt(row.registers) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatInt(row.depositors) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatDecimal(row.depositAmount) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatDecimal(row.withdrawAmount) }}
                  </td>
                  <td
                    class="px-3 py-2 text-right tabular-nums"
                    :class="row.winLose < 0 ? 'text-error' : ''"
                    data-testid="ru-winlose"
                    :data-negative="row.winLose < 0 ? 'true' : 'false'"
                  >
                    {{ formatDecimal(row.winLose) }}
                  </td>
                  <td
                    class="px-3 py-2 text-right tabular-nums"
                    data-testid="ru-spend"
                    :data-null="row.spend === null ? 'true' : 'false'"
                    :title="spendTitle(row.spendCurrency, row.adCount)"
                  >
                    {{ formatDecimal(row.spend) }}
                    <span
                      v-if="row.spendCurrency && row.spendCurrency !== 'THB'"
                      class="ml-1 text-xs text-muted"
                      data-testid="ru-currency"
                    >{{ row.spendCurrency }}</span>
                  </td>
                  <td
                    class="px-3 py-2 text-right tabular-nums"
                    data-testid="ru-cpd"
                    :data-null="row.costPerDeposit === null ? 'true' : 'false'"
                  >
                    {{ formatDecimal(row.costPerDeposit) }}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr
                  class="border-t border-default bg-elevated/50 font-semibold"
                  data-testid="ru-foot"
                  :data-total="total"
                  :data-shown="rows.length"
                >
                  <td class="px-3 py-2" colspan="5">
                    {{ footLabel }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatInt(report.totals.registers) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatInt(report.totals.depositors) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatDecimal(report.totals.depositAmount) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatDecimal(report.totals.withdrawAmount) }}
                  </td>
                  <td
                    class="px-3 py-2 text-right tabular-nums"
                    :class="report.totals.winLose < 0 ? 'text-error' : ''"
                  >
                    {{ formatDecimal(report.totals.winLose) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatDecimal(report.totals.spend) }}
                  </td>
                  <td class="px-3 py-2 text-right tabular-nums">
                    {{ formatDecimal(report.totals.costPerDeposit) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
