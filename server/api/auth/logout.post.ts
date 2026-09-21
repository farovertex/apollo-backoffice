/**
 * POST /api/auth/logout → revokes the API session (POST /auth/logout, errors ignored — the token may already be
 * revoked or expired), clears the sealed cookie, 204.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const session = await getApiSession(event)

  if (session.data.token) {
    await apiFetch<unknown>(event, '/auth/logout', { method: 'POST' }).catch(() => undefined)
  }

  await session.clear()
  // h3's clearSession() only re-sets the cookie to an empty value without Max-Age (a browser session cookie): emit a real
  // deleting cookie (Max-Age=0) for the same name/path — h3's setCookie replaces the header with the same name+path.
  deleteCookie(event, config.session.name, sessionCookieOptions(event))
  setResponseStatus(event, 204)
  return null
})
