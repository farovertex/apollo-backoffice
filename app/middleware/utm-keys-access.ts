/**
 * FEAT-090 — `/settings/utm-keys` (`definePageMeta({ middleware: 'utm-keys-access' })`).
 *
 * The page is **GOD only** (`GET /utm-keys` / `PATCH /utm-keys/:id` answer 403 for anybody else). An **Admin**
 * has a settings area of their own, so they are sent to the tab they do have (`/settings/prefixes`) instead of
 * home; everybody else — in practice a Payment-only admin, who has no settings tab at all — gets the
 * `god-only` behaviour (home). Both carry the standard "Not allowed" toast, shown immediately on a client
 * navigation and carried by the flash cookie across an SSR redirect on a direct URL load
 * (`app/utils/flash.ts`, the `prefixes-access` pattern). No `GET /utm-keys` is ever issued for them; the API
 * stays the authority.
 */
const DESCRIPTION = 'This page is available to GOD admins only'

export default defineNuxtRouteMiddleware(() => {
  const { admin } = useAuth()
  const roles = admin.value?.roles ?? []
  if (roles.includes('GOD')) return

  notifyRedirect({
    title: 'Not allowed',
    description: DESCRIPTION,
    color: 'error'
  })

  return navigateTo(roles.includes('Admin') ? '/settings/prefixes' : '/', { replace: true })
})
