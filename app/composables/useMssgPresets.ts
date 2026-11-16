/**
 * FEAT-101 v1.13 (D24 / D25) — `GET /mssg-sites/:id/presets`: mssg's preset names, swatches and the plan flag of each tile.
 * Loaded when step 3 opens (one GET, read-only, no job). `error` → the tiles fall back to ids (see `mssgPresetTiles`).
 */
import type { MssgPresetsView } from '#shared/types/mssg-sites'

export function useMssgPresets(siteId: Ref<string> | (() => string)) {
  const api = useApi()
  const id = () => (typeof siteId === 'function' ? siteId() : siteId.value)
  const data = ref<MssgPresetsView | null>(null)
  const state = ref<'loading' | 'ready' | 'error'>('loading')
  let seq = 0

  async function load() {
    const my = ++seq
    const site = id()
    if (!site) return
    state.value = 'loading'
    try {
      const v = await api<MssgPresetsView>(`/mssg-sites/${encodeURIComponent(site)}/presets`, { retry: 0 })
      if (my !== seq) return
      data.value = v && Array.isArray(v.items) ? v : null
      state.value = data.value ? 'ready' : 'error'
    } catch {
      if (my !== seq) return
      data.value = null
      state.value = 'error'
    }
  }
  onMounted(load)
  watch(id, load)
  return { data, state, reload: load }
}
