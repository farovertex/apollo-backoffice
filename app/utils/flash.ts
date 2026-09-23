/**
 * FEAT-009 — the one-shot "Not allowed" message a redirecting middleware leaves behind, on both rendering paths.
 *
 * Two paths, because they have opposite constraints (BUG-009):
 *  - **client navigation** — the layout and its toaster are already mounted, so `notifyRedirect()` adds the toast
 *    straight away. No cookie is written, which is what makes a stale flash impossible: the previous version
 *    round-tripped through the cookie and the layout only consumed it on mount / on a `route.fullPath` change, so a
 *    redirect that lands back on the route the user is already on (`/` → `/admins` → `/`) consumed nothing and the
 *    cookie then popped on the next page they opened.
 *  - **server (direct URL load)** — a middleware that returns `navigateTo()` during the server render aborts that
 *    render, so there is no toaster and no payload; `useCookie()` is useless too (it only flushes on the
 *    `app:rendered` hook, which never runs). A `Set-Cookie` written straight onto the response event survives the
 *    302, and `app/layouts/default.vue` turns it into the toast when the redirect target mounts.
 *
 * The layout consumes the cookie on mount **and** in `router.afterEach` (which also fires for a redirect to the
 * current route), so whatever queued it, it is shown once and cleared once.
 */

export const FLASH_COOKIE = 'bo-flash'
/** seconds — long enough for the redirect, short enough never to surface on a later visit */
const FLASH_MAX_AGE = 30

export interface FlashMessage {
  title: string
  description?: string
  color?: 'error' | 'warning' | 'success' | 'info' | 'neutral'
}

/**
 * Tell the user why they were redirected: toast now on the client, `Set-Cookie` for the server render.
 * Call it right before `return navigateTo(...)` in a middleware.
 */
export function notifyRedirect(message: FlashMessage): void {
  if (import.meta.client) {
    // middleware runs inside the Nuxt app context, so the app-level toast state is reachable from here
    useToast().add({
      title: message.title,
      description: message.description,
      color: message.color ?? 'info'
    })
    return
  }
  setFlash(message)
}

/**
 * Queue a message for the page the browser lands on next.
 * Server-side this is the only way to carry it across the redirect; on the client prefer `notifyRedirect()`.
 */
export function setFlash(message: FlashMessage): void {
  const cookie = `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify(message))}; Path=/; Max-Age=${FLASH_MAX_AGE}; SameSite=Lax`

  if (import.meta.client) {
    document.cookie = cookie
    return
  }

  // server: write the header now — the redirect response carries it, unlike `useCookie` (app:rendered only)
  const header = useResponseHeader('set-cookie')
  const current = header.value as string | string[] | undefined
  if (current === undefined || current === '') {
    header.value = cookie
  } else {
    header.value = [...(Array.isArray(current) ? current : [current]), cookie] as unknown as string
  }
}

/** Read and immediately clear the queued message (client only; returns `null` when there is none). */
export function takeFlash(): FlashMessage | null {
  if (!import.meta.client) return null

  const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${FLASH_COOKIE}=([^;]*)`))
  const raw = match?.[1]
  if (!raw) return null

  document.cookie = `${FLASH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`

  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw))
    if (parsed && typeof parsed === 'object' && typeof (parsed as FlashMessage).title === 'string') {
      return parsed as FlashMessage
    }
  } catch {
    // a truncated or hand-written cookie is simply dropped
  }
  return null
}
