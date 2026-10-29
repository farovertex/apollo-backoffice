/**
 * FEAT-084 (spec "UI behaviour", A13) — the per-page "แสดงเป็น: THB | สกุลของบัญชี" choice.
 *
 * One `localStorage` key per page, `money-mode:<pageKey>` (same spirit as `am-name-collapsed`); nothing is shared
 * across pages. The stored value is read in `onMounted` so the server render and the first client render agree
 * (no hydration mismatch); every storage access is guarded — a blocked/missing `localStorage` keeps the default
 * and never throws. Default `thb`, except `topups` → `account` (every top-up row is money paid in that currency).
 *
 * pageKeys in use: `tiktok-accounts` · `ads-monitor` · `topups` · `order-report` · `advertisers-slideover` ·
 * `ad-slideover`. Report pages (`/`, `/report-performance`, `/report-utm`) have no switch and never call this.
 */
import type { MoneyMode } from '~/utils/money'

export function defaultMoneyMode(pageKey: string): MoneyMode {
  return pageKey === 'topups' ? 'account' : 'thb'
}

export function moneyModeStorageKey(pageKey: string): string {
  return `money-mode:${pageKey}`
}

export function useMoneyMode(pageKey: string) {
  const key = moneyModeStorageKey(pageKey)
  const mode = ref<MoneyMode>(defaultMoneyMode(pageKey))

  onMounted(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === 'thb' || stored === 'account') mode.value = stored
    } catch {
      // storage unavailable — keep the default
    }
  })

  function setMode(value: MoneyMode) {
    mode.value = value
    try {
      localStorage.setItem(key, value)
    } catch {
      // storage unavailable — the choice lasts for this page view only
    }
  }

  const isThb = computed(() => mode.value === 'thb')

  return { mode: readonly(mode), setMode, isThb }
}
