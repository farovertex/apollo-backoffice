/**
 * FEAT-095 (spec "Deep links", AC-20) — scroll to and flash a row that a notification links to, then clear the
 * special query so a reload / back does not re-fire it. A missing row (already gone, filtered out, on another
 * page) toasts "ไม่พบรายการนี้แล้ว" and leaves the page as it is.
 *
 * Pages call it from `onMounted` (client only). The row is located by `[data-testid=<rowTestId>][data-id=<id>]`;
 * because the lists load asynchronously (and some poll), the helper retries for a short while and, once found,
 * re-asserts `data-highlight="1"` across the 4 s window so a re-render cannot wipe it.
 */
export const NT_HIGHLIGHT_MS = 4_000
const FIND_INTERVAL_MS = 150
const FIND_ATTEMPTS = 24 // ~3.6 s to let an async list render

/** poll the DOM for `[data-testid=<rowTestId>][data-id=<id>]`, resolving true once it exists or false on timeout */
export function waitForRow(rowTestId: string, id: string, timeoutMs = 1800): Promise<boolean> {
  if (!import.meta.client) return Promise.resolve(false)
  const sel = `[data-testid="${rowTestId}"][data-id="${CSS.escape(id)}"]`
  return new Promise((resolve) => {
    if (document.querySelector(sel)) return resolve(true)
    const started = Date.now()
    const timer = setInterval(() => {
      if (document.querySelector(sel)) {
        clearInterval(timer)
        resolve(true)
      } else if (Date.now() - started >= timeoutMs) {
        clearInterval(timer)
        resolve(false)
      }
    }, 150)
  })
}

export interface RowDeepLinkOptions {
  /** `ta-row` | `tp-row` | `od-build` | `rb-row` */
  rowTestId: string
  id: string
  /** query keys to strip with `router.replace` after acting (whether or not the row was found) */
  clearKeys: string[]
  /** pick a tab / drop a filter / expand before the row can be found */
  prepare?: () => void | Promise<void>
  /** run once the row element exists (e.g. open the OTP modal, expand the build) */
  onFound?: (el: HTMLElement) => void | Promise<void>
}

export function useRowDeepLink() {
  const route = useRoute()
  const router = useRouter()
  const toast = useToast()

  function selector(opts: RowDeepLinkOptions): string {
    return `[data-testid="${opts.rowTestId}"][data-id="${CSS.escape(opts.id)}"]`
  }

  function findRow(opts: RowDeepLinkOptions): HTMLElement | null {
    return document.querySelector<HTMLElement>(selector(opts))
  }

  function clearQuery(keys: string[]): void {
    if (!keys.length) return
    const next: Record<string, unknown> = {}
    let changed = false
    for (const [k, v] of Object.entries(route.query)) {
      if (keys.includes(k)) {
        changed = true
        continue
      }
      next[k] = v
    }
    if (changed) void router.replace({ path: route.path, query: next as Record<string, string> })
  }

  function highlight(opts: RowDeepLinkOptions): void {
    const first = findRow(opts)
    if (!first) return
    first.scrollIntoView({ block: 'center', behavior: 'smooth' })
    first.setAttribute('data-highlight', '1')
    // re-assert across the window: the list may re-render (poll / stream) and drop the attribute
    const reassert = setInterval(() => {
      findRow(opts)?.setAttribute('data-highlight', '1')
    }, 500)
    setTimeout(() => {
      clearInterval(reassert)
      findRow(opts)?.removeAttribute('data-highlight')
    }, NT_HIGHLIGHT_MS)
  }

  async function run(opts: RowDeepLinkOptions): Promise<void> {
    if (!import.meta.client) return
    await opts.prepare?.()
    await nextTick()

    let attempts = 0
    const tick = async () => {
      const el = findRow(opts)
      if (el) {
        highlight(opts)
        await opts.onFound?.(el)
        clearQuery(opts.clearKeys)
        return
      }
      if (++attempts >= FIND_ATTEMPTS) {
        toast.add({ title: 'ไม่พบรายการนี้แล้ว', color: 'warning' })
        clearQuery(opts.clearKeys)
        return
      }
      setTimeout(() => void tick(), FIND_INTERVAL_MS)
    }
    await tick()
  }

  return run
}
