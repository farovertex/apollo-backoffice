/**
 * FEAT-063 (api-contract.md v1 "BO usage") — the two calls behind every star: idempotent `PUT` (set) /
 * `DELETE` (unset) `/tiktok-accounts/:id/favorite`, no body, 200 `{ id, favorite }`. Shared by
 * `app/components/tiktok-accounts/FavoriteStar.vue` on both `/tiktok-accounts` and `/launch-ads` — the toggle is
 * per **admin**, not per page, and both pages star the same account id.
 */
import type { FavoriteToggleResponse } from '#shared/types/tiktok-accounts'

export function useAccountFavorite() {
  const api = useApi()

  /** `next` = the state to set (true → PUT, false → DELETE); resolves to the server's own `favorite`. */
  async function toggleFavorite(accountId: string, next: boolean): Promise<boolean> {
    const res = await api<FavoriteToggleResponse>(`/tiktok-accounts/${encodeURIComponent(accountId)}/favorite`, {
      method: next ? 'PUT' : 'DELETE',
      retry: 0
    })
    return res.favorite
  }

  return { toggleFavorite }
}
