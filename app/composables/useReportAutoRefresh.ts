/**
 * FEAT-069 — the self refresh of `/reports/performance` and `/reports/dashboard` (spec "UI behaviour → Shared",
 * api-contract.md v1 §6; the other `/reports/*` pages keep "no polling", A11).
 *
 * - `setInterval(intervalMs)` → `load()` only while `document.visibilityState === 'visible'`;
 * - `visibilitychange` → visible and the last **successful** load is older than `intervalMs` → `load()` at once;
 * - both are removed on unmount.
 *
 * `load` is the page's own loader; it must resolve after updating the page, and call `markLoaded()` (returned
 * here) when the answer was applied — that is the clock of `<p>-updated` and of the catch-up rule. The page
 * still calls `load()` itself on URL changes / the refresh button.
 */
export function useReportAutoRefresh(load: () => Promise<void>, options: { intervalMs?: number } = {}) {
  const intervalMs = options.intervalMs ?? 300_000
  const lastLoadedAt = ref<number | null>(null)
  const loading = ref(false)
  let timer: ReturnType<typeof setInterval> | null = null

  async function run() {
    loading.value = true
    try {
      await load()
    } finally {
      loading.value = false
    }
  }

  function markLoaded() {
    lastLoadedAt.value = Date.now()
  }

  function onTick() {
    if (document.visibilityState !== 'visible') return
    void run()
  }

  function onVisibility() {
    if (document.visibilityState !== 'visible') return
    const last = lastLoadedAt.value
    if (last === null || Date.now() - last > intervalMs) void run()
  }

  onMounted(() => {
    timer = setInterval(onTick, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)
  })

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer)
    timer = null
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { lastLoadedAt, loading, markLoaded }
}
