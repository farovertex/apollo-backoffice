/**
 * FEAT-009 — GOD-only pages (`definePageMeta({ middleware: 'god-only' })`).
 *
 * Runs after the global `auth.global.ts` (which already resolved the session, or sent an anonymous visitor to
 * `/login?redirect=…`). A logged-in admin without the `GOD` role is sent home with a one-shot flash message that
 * `app/layouts/default.vue` turns into the "Not allowed" toast — on a client navigation and on a direct URL load
 * alike (see `app/utils/flash.ts`). No request to `/backend/admins` is ever issued for such an admin; the API
 * stays the authority (`@Roles('GOD')`).
 */
export default defineNuxtRouteMiddleware(() => {
  const { admin } = useAuth()
  if (admin.value?.roles.includes('GOD')) return

  setFlash({
    title: 'Not allowed',
    description: 'Admin Management is available to GOD admins only',
    color: 'error'
  })

  return navigateTo('/', { replace: true })
})
