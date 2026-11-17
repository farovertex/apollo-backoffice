/**
 * FEAT-100 (spec "Permissions", AC-1) — `/mssg-pages` (`definePageMeta({ middleware: 'mssg-pages-access' })`).
 *
 * GOD and Admin pass. Everybody else — in practice a Payment-only admin — gets exactly the `god-only` behaviour:
 * "Not allowed" toast + home, the toast carried by the flash cookie across an SSR redirect on a direct URL load
 * (`app/utils/flash.ts`). No `/mssg-accounts*` request is issued for such an admin; the API stays the authority
 * (`@Roles('GOD','Admin')`).
 *
 * FEAT-102 — `/bc-pixels` uses this same middleware (spec "UI behaviour → Menu": "same gate as `/mssg-pages`"); the
 * rule is the plain GOD/Admin check, nothing mssg-specific.
 */
const DESCRIPTION = 'This page is available to GOD and Admin admins only'

export default defineNuxtRouteMiddleware(() => {
  const { admin } = useAuth()
  const roles = admin.value?.roles ?? []
  if (roles.includes('GOD') || roles.includes('Admin')) return

  notifyRedirect({
    title: 'Not allowed',
    description: DESCRIPTION,
    color: 'error'
  })

  return navigateTo('/', { replace: true })
})
