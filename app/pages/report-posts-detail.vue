<script setup lang="ts">
/**
 * FEAT-089 — `/reports/posts/:key` detail (test-id prefix `rp-`; spec "UI behaviour → /reports/posts/:key",
 * api-contract.md v1 §3). A flat file (not `app/pages/reports/posts/[key].vue`) with `definePageMeta({ path })`
 * — same trick as `report-posts.vue`/`report-utm.vue`: a page nested under `app/pages/reports/` would become
 * a child of `app/pages/reports.vue`, which has no `<NuxtPage>`.
 *
 * URL = `:key` (route param) + `range/from/to/workspaceId/by` (query, same semantics as the list page, no
 * `prefix`/`enoughOnly` per contract §3). The back link (`rp-back`) keeps the whole query so the list page
 * reopens exactly where it was left.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PostReportLens, PostsDetailResponse } from '#shared/types/report-posts'

const route = useRoute()
const api = useApi()
const auth = useAuth()

const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))

const key = computed(() => String(route.params.key ?? ''))

useSeoMeta({ title: 'Reports — Post detail' })
definePageMeta({ path: '/reports/posts/:key' })

const LOAD_FALLBACK = 'โหลดรายงานไม่สำเร็จ'
const FORBIDDEN_TEXT = 'คุณไม่มีสิทธิ์ดูรายงานนี้'
const NOT_FOUND_TEXT = 'ไม่พบข้อมูลของรายการนี้ในช่วงที่เลือก'

function queryString(k: string): string {
  const value = route.query[k]
  return typeof value === 'string' ? value.trim() : ''
}

const rangeState = computed(() => parseReportRange(route.query, '30d'))
const rangeInvalid = computed(() => reportRangeInvalid(rangeState.value))
const workspaceId = computed(() => (isGod.value ? parseWorkspaceId(route.query) : ''))
const by = computed<PostReportLens>(() => {
  const raw = queryString('by')
  return (POST_LENS_ORDER as string[]).includes(raw) ? (raw as PostReportLens) : 'post'
})

const requestQuery = computed(() => ({
  ...reportRangeQuery(rangeState.value),
  ...(workspaceId.value ? { workspaceId: workspaceId.value } : {}),
  by: by.value
}))

const backQuery = computed(() => ({ ...route.query }))

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const report = ref<PostsDetailResponse | null>(null)
const pending = ref(true)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
const notFound = ref(false)
let session = 0

async function load() {
  if (rangeInvalid.value || !key.value) {
    session++
    pending.value = false
    return
  }
  const s = ++session
  pending.value = true
  try {
    const res = await api<PostsDetailResponse>(`/reports/posts/${encodeURIComponent(key.value)}`, { retry: 0, query: requestQuery.value })
    if (s !== session) return
    report.value = res
    error.value = null
    forbidden.value = null
    notFound.value = false
    auto.markLoaded()
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    const issue = err.data?.issues?.[0]?.message
    const message = (status === 400 ? issue : undefined) ?? err.data?.error ?? err.message ?? LOAD_FALLBACK
    report.value = null
    if (status === 403) {
      forbidden.value = FORBIDDEN_TEXT
      error.value = null
      notFound.value = false
    } else if (status === 404) {
      notFound.value = true
      forbidden.value = null
      error.value = null
    } else {
      forbidden.value = null
      notFound.value = false
      error.value = message
    }
  } finally {
    if (s === session) pending.value = false
  }
}

const auto = useReportAutoRefresh(load)

const loadKey = computed(() => JSON.stringify([
  key.value, rangeState.value.range, rangeState.value.from, rangeState.value.to, workspaceId.value, by.value
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

const showSkeleton = computed(() => pending.value && !report.value && !error.value && !forbidden.value && !notFound.value)
const pageState = computed(() => {
  if (forbidden.value) return 'forbidden'
  if (notFound.value) return 'notfound'
  if (error.value && !report.value) return 'error'
  if (showSkeleton.value) return 'loading'
  return 'ready'
})
</script>

<template>
  <UDashboardPanel id="report-posts-detail">
    <template #header>
      <UDashboardNavbar title="Post detail">
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
            data-testid="rp-detail-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rp-detail-page"
        :data-state="pageState"
        :data-key="key"
        class="flex min-w-0 flex-1 flex-col gap-5"
      >
        <NuxtLink
          :to="{ path: '/reports/posts', query: backQuery }"
          class="flex items-center gap-1 text-sm text-muted hover:text-highlighted"
          data-testid="rp-back"
        >
          <UIcon name="i-lucide-arrow-left" class="size-4" />
          <span>กลับไปที่รายการ</span>
        </NuxtLink>

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          :title="forbidden"
          data-testid="rp-detail-forbidden"
        />

        <div
          v-else-if="notFound"
          class="flex flex-col items-start gap-2 rounded-lg border border-dashed border-default p-4 text-sm text-muted"
          data-testid="rp-notfound"
        >
          <p>{{ NOT_FOUND_TEXT }}</p>
          <NuxtLink :to="{ path: '/reports/posts', query: backQuery }" class="text-primary hover:underline">
            กลับไปที่รายการ
          </NuxtLink>
        </div>

        <template v-else>
          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="rp-detail-error"
          >
            <template #actions>
              <UButton
                label="ลองใหม่"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rp-detail-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <div v-if="showSkeleton" class="flex flex-col gap-3" data-testid="rp-detail-loading">
            <USkeleton class="h-32 w-full" />
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <USkeleton v-for="n in 3" :key="n" class="h-28" />
            </div>
            <USkeleton class="h-48 w-full" />
          </div>

          <div
            v-else-if="report"
            class="flex min-w-0 flex-col gap-5 transition-opacity"
            :class="pending ? 'opacity-70' : ''"
            data-testid="rp-detail-content"
          >
            <ReportPostsDetailHead
              :row="report.head"
              :by="report.by"
              :prefixes="report.prefixes"
              :monitor-campaign-id="report.monitorCampaignId"
            />

            <ReportPostsLayerCards :row="report.head" />

            <ReportPostsFunnel :funnel="report.funnel" :row="report.head" />

            <ReportPostsByDayChart :days="report.byDayAfterApproval" />

            <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <ReportPostsReasons :reasons="report.rejectReasons" />
              <ReportPostsSetups :setups="report.setups" />
            </div>

            <ReportPostsBuildsTable :builds="report.builds" :truncated="report.buildsTruncated" />
          </div>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
