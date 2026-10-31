<script setup lang="ts">
/**
 * FEAT-089 — Reports → Posts (`/reports/posts`, test-id prefix `rp-`; spec "UI behaviour → /reports/posts",
 * api-contract.md v1 §2). Every Spark post (or, by lens, ad template / ad-group template / account) published
 * in the range, scored on three layers: review, survival, money (spec "Definitions").
 *
 * **The URL is the state** (`range/from/to/workspaceId/by/prefix/enoughOnly`), like `/reports/performance`: a
 * change issues exactly one `GET /reports/posts` (`retry: 0`, a session counter drops a superseded answer),
 * 5-minute visible-only auto refresh (`useReportAutoRefresh`). Not `useReportScopeState` — that composable's
 * range default is pinned `today` and only carries one extra enum key; this page needs a `30d` default plus
 * three extra keys (`by`/`prefix`/`enoughOnly`), so it follows `report-utm.vue`'s hand-rolled pattern instead
 * (same `app/utils/report-range.ts` helpers, same `setQuery` shape).
 *
 * `enoughOnly`'s UI default is **on** (unlike the API's own default `0`): the switch being on omits the key
 * from the URL (back to the page default) and the request always sends `enoughOnly=1` explicitly; off sends
 * `enoughOnly=0` and the not-enough rows stay, dimmed (`rp-row-dim`).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PostReportLens, PostsListResponse } from '#shared/types/report-posts'
import type { ReportRange } from '#shared/types/reports'

useSeoMeta({ title: 'Reports — Posts' })
definePageMeta({ path: '/reports/posts' })

const LOAD_FALLBACK = 'โหลดรายงานไม่สำเร็จ'
const FORBIDDEN_TEXT = 'คุณไม่มีสิทธิ์ดูรายงานนี้'
const EMPTY_TEXT = 'ไม่มี build ที่เผยแพร่ในช่วงนี้'

const route = useRoute()
const router = useRouter()
const api = useApi()
const auth = useAuth()

const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))

function queryString(key: string): string {
  const value = route.query[key]
  return typeof value === 'string' ? value.trim() : ''
}

function setQuery(patch: Record<string, string | undefined>) {
  const merged = { ...route.query, ...patch }
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string' && value !== '') next[key] = value
  }
  void router.replace({ query: next })
}

// ── url state ────────────────────────────────────────────────────────────────────────────────────────────────────────
const rangeState = computed(() => parseReportRange(route.query, '30d'))
const rangeInvalid = computed(() => reportRangeInvalid(rangeState.value))
const workspaceId = computed(() => (isGod.value ? parseWorkspaceId(route.query) : ''))
const by = computed<PostReportLens>(() => {
  const raw = queryString('by')
  return (POST_LENS_ORDER as string[]).includes(raw) ? (raw as PostReportLens) : 'post'
})
const prefix = computed(() => queryString('prefix'))
/** on by default (the UI default); only `enoughOnly=0` lives in the URL */
const enoughOnlyUi = computed(() => queryString('enoughOnly') !== '0')

const requestQuery = computed(() => ({
  ...reportRangeQuery(rangeState.value),
  ...(workspaceId.value ? { workspaceId: workspaceId.value } : {}),
  by: by.value,
  ...(prefix.value ? { prefix: prefix.value } : {}),
  enoughOnly: enoughOnlyUi.value ? '1' : '0'
}))

function onRange(patch: { range: ReportRange, from?: string, to?: string }) {
  setQuery(rangeUrlPatch({ range: patch.range, from: patch.from ?? '', to: patch.to ?? '' }, '30d'))
}

function onWorkspace(id: string) {
  setQuery({ workspaceId: id || undefined })
}

function onLens(next: PostReportLens) {
  setQuery({ by: next === 'post' ? undefined : next })
}

function onPrefix(next: string) {
  setQuery({ prefix: next || undefined })
}

function onEnoughOnly(on: boolean) {
  setQuery({ enoughOnly: on ? undefined : '0' })
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const report = ref<PostsListResponse | null>(null)
const pending = ref(true)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
/** survives a failed reload so the pickers never empty */
const workspaces = ref<PostsListResponse['scope']['workspaces']>([])
const prefixes = ref<string[]>([])
let session = 0

async function load() {
  if (rangeInvalid.value) {
    session++
    pending.value = false
    return
  }
  const s = ++session
  pending.value = true
  try {
    const res = await api<PostsListResponse>('/reports/posts', { retry: 0, query: requestQuery.value })
    if (s !== session) return
    report.value = res
    workspaces.value = res.scope.workspaces
    prefixes.value = res.prefixes
    error.value = null
    forbidden.value = null
    auto.markLoaded()
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    const issue = err.data?.issues?.[0]?.message
    const message = (status === 400 ? issue : undefined) ?? err.data?.error ?? err.message ?? LOAD_FALLBACK
    if (status === 403) {
      forbidden.value = FORBIDDEN_TEXT
      error.value = null
      report.value = null
    } else {
      forbidden.value = null
      error.value = message
    }
  } finally {
    if (s === session) pending.value = false
  }
}

const auto = useReportAutoRefresh(load)

const loadKey = computed(() => JSON.stringify([
  rangeState.value.range, rangeState.value.from, rangeState.value.to,
  workspaceId.value, by.value, prefix.value, enoughOnlyUi.value
]))

watch(loadKey, () => {
  void load()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

// ── derived ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const showSkeleton = computed(() => pending.value && !report.value && !error.value && !forbidden.value)
const isEmpty = computed(() => !!report.value && report.value.rows.length === 0 && report.value.summary.builds === 0)
const pageState = computed(() => {
  if (forbidden.value) return 'forbidden'
  if (error.value && !report.value) return 'error'
  if (showSkeleton.value) return 'loading'
  if (isEmpty.value) return 'empty'
  return 'ready'
})

function openRow(key: string) {
  void navigateTo({
    path: `/reports/posts/${encodeURIComponent(key)}`,
    query: { ...(by.value !== 'post' ? { by: by.value } : {}), ...route.query }
  })
}
</script>

<template>
  <UDashboardPanel id="report-posts">
    <template #header>
      <UDashboardNavbar title="Posts">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            label="รีเฟรช"
            aria-label="รีเฟรช"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="rp-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rp-page"
        :data-state="pageState"
        :data-range="rangeState.range"
        :data-by="by"
        :data-pending="pending ? 'true' : 'false'"
        class="flex min-w-0 flex-1 flex-col gap-5"
      >
        <ReportPostsToolbar
          :range="rangeState"
          :pending="pending"
          :is-god="isGod"
          :workspaces="workspaces"
          :workspace-id="workspaceId"
          :prefixes="prefixes"
          :prefix="prefix"
          :enough-only="enoughOnlyUi"
          :last-loaded-at="auto.lastLoadedAt.value"
          @range="onRange"
          @workspace="onWorkspace"
          @prefix="onPrefix"
          @enough-only="onEnoughOnly"
        />

        <div
          role="tablist"
          aria-label="เลนส์"
          class="flex flex-wrap gap-1"
          data-testid="rp-lens-tabs"
        >
          <UButton
            v-for="lens in POST_LENS_ORDER"
            :key="lens"
            role="tab"
            :aria-selected="by === lens"
            :label="POST_LENS_LABEL[lens]"
            size="sm"
            :color="by === lens ? 'primary' : 'neutral'"
            :variant="by === lens ? 'soft' : 'ghost'"
            data-testid="rp-lens"
            :data-lens="lens"
            @click="onLens(lens)"
          />
        </div>

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="forbidden"
          data-testid="rp-forbidden"
        />

        <template v-else>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="rp-error"
          >
            <template #actions>
              <UButton
                label="ลองใหม่"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rp-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <div v-if="showSkeleton" class="flex flex-col gap-3" data-testid="rp-loading">
            <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <USkeleton v-for="n in 5" :key="n" class="h-24" />
            </div>
            <USkeleton class="h-64 w-full" />
          </div>

          <div
            v-else-if="report"
            class="flex min-w-0 flex-col gap-5 transition-opacity"
            :class="pending ? 'opacity-70' : ''"
            data-testid="rp-content"
          >
            <p
              v-if="isEmpty"
              class="rounded-lg border border-dashed border-default p-3 text-sm text-muted"
              data-testid="rp-empty"
            >
              {{ EMPTY_TEXT }}
            </p>

            <ReportPostsSummaryTiles :summary="report.summary" />

            <ReportPostsTable
              :rows="report.rows"
              :summary="report.summary"
              :gate="report.gate"
              :enough-only="enoughOnlyUi"
              @open="openRow"
            />

            <p v-if="report.rowsTruncated" class="text-xs text-warning" data-testid="rp-rows-truncated">
              แสดงสูงสุด 500 แถว ยังมีรายการเกินกว่านี้
            </p>
            <p v-if="report.truncated" class="text-xs text-warning" data-testid="rp-truncated">
              มี build เกินกว่าที่ระบบสแกนได้ในช่วงนี้ ผลลัพธ์อาจไม่ครบ
            </p>

            <p class="text-xs text-muted" data-testid="rp-notes">
              เวลาตรวจ = เวลาตั้งแต่เผยแพร่ถึงเริ่มมี impression แรก (TikTok) · อยู่รอด = นับจากวันที่ผ่านตรวจถึงถูกแบน/หาย/ลบ (ปิดเองยังนับว่าอยู่)
              · deposit มาจาก UTM key ของ build — key ที่หลายแถวถือร่วมกันจะนับเต็มให้ทุกแถว · Spend เป็น THB (แปลงด้วยอัตรารายวัน)
              · แถวสีจางคือข้อมูลยังไม่พอจะจัดอันดับ
            </p>
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
