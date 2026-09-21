/**
 * POST /api/auth/logout → revokes the API session (POST /auth/logout, errors ignored — the token may already be
 * revoked or expired), clears the sealed cookie, 204.
 */
export default defineEventHandler(async (event) => {
  const session = await getApiSession(event)

  if (session.data.token) {
    await apiFetch<unknown>(event, '/auth/logout', { method: 'POST' }).catch(() => undefined)
  }

  await session.clear()
  setResponseStatus(event, 204)
  return null
})
