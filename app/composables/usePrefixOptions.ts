/**
 * FEAT-076 (api-contract §7) — the prefix list of the account modals: exactly one
 * `GET /backend/prefixes?status=active` per `load()` (the modals call it when they open). The API already scopes
 * it: GOD = every active prefix, Admin / Payment = the active prefixes they manage. A late answer of a superseded
 * load (modal closed / reopened) is dropped.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PrefixView, PrefixesResponse } from '#shared/types/prefixes'

export function usePrefixOptions() {
  const api = useApi()
  const prefixes = ref<PrefixView[]>([])
  const pending = ref(false)
  const loaded = ref(false)
  const error = ref<string | null>(null)
  let seq = 0

  /** loaded, no error, nothing to pick — the modals show the empty alert and disable submit */
  const empty = computed(() => loaded.value && !error.value && prefixes.value.length === 0)

  async function load() {
    const s = ++seq
    pending.value = true
    loaded.value = false
    error.value = null
    try {
      // retry: 0 — one request per open
      const res = await api<PrefixesResponse>('/prefixes', { query: { status: 'active' }, retry: 0 })
      if (s !== seq) return
      prefixes.value = res.prefixes ?? []
      loaded.value = true
    } catch (e) {
      if (s !== seq) return
      const err = e as FetchError<Partial<ApiErrorBody>>
      prefixes.value = []
      error.value = err.data?.error ?? err.message ?? 'โหลดรายการ prefix ไม่สำเร็จ'
    } finally {
      if (s === seq) pending.value = false
    }
  }

  function reset() {
    seq++
    prefixes.value = []
    pending.value = false
    loaded.value = false
    error.value = null
  }

  return { prefixes, pending, loaded, error, empty, load, reset }
}
