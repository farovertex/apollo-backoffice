/**
 * FEAT-009 — GOD-only pages (`definePageMeta({ middleware: 'god-only' })`).
 *
 * Runs after the global `auth.global.ts` (which already resolved the session, or sent an anonymous visitor to
 * `/login?redirect=…`). A logged-in admin without the `GOD` role is sent home with the "Not allowed" toast —
 * shown immediately on a client navigation, carried by the flash cookie across an SSR redirect on a direct URL
 * load (see `app/utils/flash.ts`, BUG-009). No request to `/backend/admins` is ever issued for such an admin;
 * the API stays the authority (`@Roles('GOD')`).
 */
export default defineNuxtRouteMiddleware(() => {
  const { admin } = useAuth()
  if (admin.value?.roles.includes('GOD')) return

  notifyRedirect({
    title: 'Not allowed',
    description: 'Admin Management is available to GOD admins only',
    color: 'error'
  })

  return navigateTo('/', { replace: true })
})
