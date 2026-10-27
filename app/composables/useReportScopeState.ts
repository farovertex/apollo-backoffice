/**
 * FEAT-069 — the URL state shared by `/reports/performance` and `/reports/dashboard` (spec "UI behaviour →
 * Shared", contract §6): `range` / `from` / `to` through the FEAT-065 helpers, `workspaceId` (GOD only — an
 * Admin's `?workspaceId=` is ignored and never sent, the picker is not rendered) and one extra enum key per
 * page (`tab` / `chart`), whose default is omitted from the URL and whose unknown values fall back.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { ReportRange } from '#shared/types/reports'

export function useReportScopeState<V extends string>(extra: { key: string, values: readonly V[], fallback: V }) {
  const route = useRoute()
  const router = useRouter()
  const auth = useAuth()

  const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))
  const rangeState = computed(() => parseReportRange(route.query, 'today'))
  const rangeInvalid = computed(() => reportRangeInvalid(rangeState.value))
  const workspaceId = computed(() => (isGod.value ? parseWorkspaceId(route.query) : ''))

  const extraValue = computed<V>(() => {
    const raw = route.query[extra.key]
    return typeof raw === 'string' && (extra.values as readonly string[]).includes(raw) ? (raw as V) : extra.fallback
  })

  function setQuery(patch: Record<string, string | undefined>) {
    const merged = { ...route.query, ...patch }
    const next: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
      if (typeof value === 'string' && value !== '') next[key] = value
    }
    void router.replace({ query: next })
  }

  function onRange(patch: { range: ReportRange, from?: string, to?: string }) {
    setQuery(rangeUrlPatch({ range: patch.range, from: patch.from ?? '', to: patch.to ?? '' }, 'today'))
  }

  function onWorkspace(id: string) {
    setQuery({ workspaceId: id || undefined })
  }

  function setExtra(value: V) {
    setQuery({ [extra.key]: value === extra.fallback ? undefined : value })
  }

  /** range part + `workspaceId` of a request */
  const requestQuery = computed(() => ({
    ...reportRangeQuery(rangeState.value),
    ...(workspaceId.value ? { workspaceId: workspaceId.value } : {})
  }))

  /** what triggers a reload: the range and the workspace (not the tab / chart) */
  const loadKey = computed(() => JSON.stringify([
    rangeState.value.range, rangeState.value.from, rangeState.value.to, workspaceId.value
  ]))

  return { isGod, rangeState, rangeInvalid, workspaceId, extraValue, setQuery, onRange, onWorkspace, setExtra, requestQuery, loadKey }
}

/** status + the API's own text of a failed request (a 400's first issue message wins) */
export function reportFailure(e: unknown, fallback: string): { status: number | undefined, message: string } {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const status = err.response?.status ?? err.statusCode
  const issue = err.data?.issues?.[0]?.message
  const message = (status === 400 ? issue : undefined) ?? err.data?.error ?? err.message ?? fallback
  return { status, message }
}

/** Bangkok "today" — only for the cosmetic "วันนี้" chip of a day row (the API resolves every range, FEAT-065 A5) */
export function bangkokToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
