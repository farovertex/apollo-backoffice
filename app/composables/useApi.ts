/**
 * The one API client for pages/components: `const api = useApi(); await api('/tiktok/accounts')`.
 * Relative to `/backend` → Nitro proxy → apollo-api with the session's bearer token injected server-side.
 * Never call apollo-api with an absolute URL from app code.
 *
 * 401 from the API (expired/revoked session) → clears auth state and sends the user to /login?redirect=…
 * The error still rejects, so `useAsyncData` callers see it in `error` (no uncaught console error).
 */
export function useApi() {
  const auth = useAuth()
  const route = useRoute()
  // SSR: forward the browser's cookie to the internal /backend call so the proxy can read the session
  const headers = useRequestHeaders(['cookie'])

  return $fetch.create({
    baseURL: '/backend',
    credentials: 'include',
    headers,
    async onResponseError({ response }) {
      if (response.status === 401 && import.meta.client && route.path !== '/login') {
        auth.clear()
        await navigateTo({ path: '/login', query: { redirect: route.fullPath } })
      }
    }
  })
}
