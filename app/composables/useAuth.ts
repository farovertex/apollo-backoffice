import type { AuthAdmin, AuthContext, LoginResponse, MeResponse } from '#shared/types/auth'

/**
 * Auth state for the app. Talks only to the BO's own Nitro endpoints (/api/auth/*) — the apollo-api token
 * stays inside the sealed httpOnly cookie on the server; the browser only ever sees `admin` + `context`.
 * State lives in useState so SSR results hydrate into the client without a second request.
 */
export function useAuth() {
  const admin = useState<AuthAdmin | null>('auth:admin', () => null)
  const context = useState<AuthContext | null>('auth:context', () => null)
  // on the server, forward the incoming cookie to the internal /api/auth/* call; empty object on the client
  const headers = useRequestHeaders(['cookie'])

  const isAuthenticated = computed(() => admin.value !== null)

  function clear() {
    admin.value = null
    context.value = null
  }

  /** Validate the current session (cookie → API GET /auth/me). Any failure = not authenticated, never throws. */
  async function fetchMe(): Promise<AuthAdmin | null> {
    try {
      const res = await $fetch<MeResponse>('/api/auth/me', { headers, credentials: 'include' })
      admin.value = res.admin
      context.value = res.context
    } catch {
      clear()
    }
    return admin.value
  }

  /** Throws the ofetch error on failure (`statusCode`, `data.error`) — the login page maps it to a message. */
  async function login(username: string, password: string): Promise<AuthAdmin> {
    const res = await $fetch<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      credentials: 'include'
    })
    admin.value = res.admin
    context.value = null
    return res.admin
  }

  /** Always ends logged out locally, even if the server call fails. */
  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // session is cleared locally regardless; the next /api/auth/me decides
    }
    clear()
  }

  return { admin, context, isAuthenticated, fetchMe, login, logout, clear }
}
