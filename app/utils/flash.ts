/**
 * FEAT-009 — one-shot "flash" message that survives a redirect, including an **SSR** redirect.
 *
 * Why a cookie and not `useState`: a middleware that returns `navigateTo()` during the server render aborts that
 * render, so the payload (and `useCookie`, which only writes on the `app:rendered` hook) never reaches the
 * browser — the user would land on `/` with no explanation. A `Set-Cookie` written straight onto the response
 * event survives the 302, and a client-side navigation writes the same cookie through `document.cookie`.
 * `app/layouts/default.vue` takes and clears it on mount and on every route change and turns it into a toast.
 */

export const FLASH_COOKIE = 'bo-flash'
/** seconds — long enough for the redirect, short enough never to surface on a later visit */
const FLASH_MAX_AGE = 30

export interface FlashMessage {
  title: string
  description?: string
  color?: 'error' | 'warning' | 'success' | 'info' | 'neutral'
}

function cookieValue(message: FlashMessage): string {
  return `${FLASH_COOKIE}=${encodeURIComponent(JSON.stringify(message))}; Path=/; Max-Age=${FLASH_MAX_AGE}; SameSite=Lax`
}

/** Queue a message for the next page the user lands on. Safe to call on the server and on the client. */
export function setFlash(message: FlashMessage): void {
  const cookie = cookieValue(message)

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
