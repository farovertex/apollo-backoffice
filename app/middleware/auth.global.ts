/**
 * Route protection. Every route needs a session unless the page opts out with `definePageMeta({ auth: false })`.
 *   - unauthenticated → /login?redirect=<to.fullPath>  (SSR redirect on first load, router redirect on client nav)
 *   - authenticated visitor of /login → its ?redirect (same-origin only) or /
 * The session is validated against the API on the server render and on every client navigation; the client
 * hydration pass reuses the server result (no duplicate request, no flash).
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const nuxtApp = useNuxtApp()
  const auth = useAuth()
  const isPublic = to.meta.auth === false

  const hydratingFromServer = import.meta.client && nuxtApp.isHydrating && nuxtApp.payload.serverRendered
  if (!hydratingFromServer) {
    await auth.fetchMe()
  }

  if (isPublic) {
    if (to.path === '/login' && auth.isAuthenticated.value) {
      return navigateTo(safeRedirectPath(to.query.redirect) ?? '/', { replace: true })
    }
    return
  }

  if (!auth.isAuthenticated.value) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } }, { replace: true })
  }
})
