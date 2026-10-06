/**
 * FEAT-009 — GOD-only pages (`definePageMeta({ middleware: 'god-only' })`).
 *
 * Runs after the global `auth.global.ts` (which already resolved the session, or sent an anonymous visitor to
 * `/login?redirect=…`). A logged-in admin without the `GOD` role is sent home with the "Not allowed" toast —
 * shown immediately on a client navigation, carried by the flash cookie across an SSR redirect on a direct URL
 * load (see `app/utils/flash.ts`, BUG-009). No request to the guarded page's API is ever issued for such an
 * admin; the API stays the authority (`@Roles('GOD')`).
 *
 * FEAT-030 (spec AS-6): the description is **route-aware** instead of a second middleware — `/admins` keeps the
 * text the FEAT-009 / BUG-009 specs assert byte for byte, every other GOD-only route (first of them
 * `/settings/auto-topup`) gets the generic sentence.
 */
const ADMINS_DESCRIPTION = 'Admin Management is available to GOD admins only'
const GENERIC_DESCRIPTION = 'This page is available to GOD admins only'

export default defineNuxtRouteMiddleware((to) => {
  const { admin } = useAuth()
  if (admin.value?.roles.includes('GOD')) return

  notifyRedirect({
    title: 'Not allowed',
    description: to.path === '/admins' ? ADMINS_DESCRIPTION : GENERIC_DESCRIPTION,
    color: 'error'
  })

  return navigateTo('/', { replace: true })
})
