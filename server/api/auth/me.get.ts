import type { AuthContext, MeResponse } from '#shared/types/auth'

const NOT_AUTHENTICATED = { error: 'not authenticated' } as const

/**
 * GET /api/auth/me
 * No session → 401. With a session: validates the token against apollo-api GET /auth/me (revoked/expired sessions
 * are detected on every navigation) → 200 `{ admin, context }`; 401 → the sealed session is cleared, 401 `{ error }`.
 */
export default defineEventHandler(async (event): Promise<MeResponse | ReturnType<typeof sendApiError>> => {
  const session = await getApiSession(event)

  if (!session.data.token) {
    setResponseStatus(event, 401)
    return NOT_AUTHENTICATED
  }

  try {
    const context = await apiFetch<AuthContext>(event, '/auth/me')
    return { admin: session.data.admin ?? null, context }
  } catch (err) {
    const e = toApiError(err)
    if (e.statusCode === 401) {
      await session.clear()
      setResponseStatus(event, 401)
      return NOT_AUTHENTICATED
    }
    return sendApiError(event, e)
  }
})
