/**
 * ANY /backend/**  →  ${NUXT_API_BASE}/**
 *
 * Same-origin proxy so the browser never talks to apollo-api directly (no CORS, no token in the browser):
 *   - forwards method, query and JSON body
 *   - injects `Authorization: Bearer` from the sealed session cookie (client-supplied Authorization is dropped)
 *   - passes status + body through unchanged (`{ error }` preserved), strips every upstream header except
 *     content-type — in particular `set-cookie` never reaches the browser
 *   - `auth/login` is NOT proxied (its 200 body carries the token) → use POST /api/auth/login
 *
 * The template's mock endpoints stay under /api/** (Nitro handlers); this prefix is reserved for apollo-api.
 */
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'content-type', 'user-agent'] as const
const NOT_PROXIED = new Set(['auth/login'])

export default defineEventHandler(async (event) => {
  const path = (getRouterParam(event, 'path') ?? '').replace(/^\/+/, '')

  if (!path || NOT_PROXIED.has(path)) {
    setResponseStatus(event, 404)
    return { error: 'not found' }
  }

  const { apiBase } = useRuntimeConfig(event)
  const session = await getApiSession(event)
  const method = event.method
  const incoming = getRequestHeaders(event)

  const headers: Record<string, string> = {}
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[name]
    if (value) {
      headers[name] = value
    }
  }
  const ip = getRequestIP(event, { xForwardedFor: true })
  if (ip) {
    headers['x-forwarded-for'] = ip
  }
  if (session.data.token) {
    headers.authorization = `Bearer ${session.data.token}`
  }

  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readBody(event).catch(() => undefined)

  try {
    const res = await $fetch.raw(path, {
      baseURL: apiBase,
      method,
      query: getQuery(event),
      body,
      headers,
      ignoreResponseError: true
    })

    setResponseStatus(event, res.status)
    const contentType = res.headers.get('content-type')
    if (contentType) {
      setResponseHeader(event, 'content-type', contentType)
    }
    return res._data ?? null
  } catch {
    setResponseStatus(event, 502)
    return { error: 'api unreachable' }
  }
})
