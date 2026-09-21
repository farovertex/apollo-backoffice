import type { LoginResponse } from '#shared/types/auth'

interface ApiLoginResponse {
  token: string
  expiresAt: string
  admin: Record<string, unknown>
}

/**
 * POST /api/auth/login { username, password }
 * → apollo-api POST /auth/login; on 200 the `{ token, expiresAt, admin }` goes into the sealed cookie and the
 *   browser only gets `{ admin }`. 401 → `{ error }` (same message for every failure, like the API). 400 passes through.
 */
export default defineEventHandler(async (event): Promise<LoginResponse | ReturnType<typeof sendApiError>> => {
  const body = await readBody<{ username?: unknown, password?: unknown } | null>(event).catch(() => null)
  const username = typeof body?.username === 'string' ? body.username : ''
  const password = typeof body?.password === 'string' ? body.password : ''

  if (!username || !password) {
    setResponseStatus(event, 400)
    return {
      error: 'validation',
      issues: [
        ...(username ? [] : [{ path: 'username', message: 'required' }]),
        ...(password ? [] : [{ path: 'password', message: 'required' }])
      ]
    }
  }

  try {
    const res = await apiFetch<ApiLoginResponse>(event, '/auth/login', {
      method: 'POST',
      body: { username, password },
      token: null
    })

    const admin = pickSessionAdmin(res.admin)
    const session = await getApiSession(event)
    await session.update({ token: res.token, expiresAt: res.expiresAt, admin })

    return { admin }
  } catch (err) {
    return sendApiError(event, err)
  }
})
