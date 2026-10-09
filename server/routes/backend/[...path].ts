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
 *
 * **Body handling (FEAT-040).** The upstream body is always read as an `ArrayBuffer`. A JSON content-type is
 * parsed and returned as an object, exactly as before. Anything else (`text/csv` of `GET /reports/utm.csv`,
 * html, pdf, images) is returned **byte-exact**: ofetch's own decoding runs `response.text()`, whose UTF-8
 * decode strips a leading BOM — the CSV export lost its `ef bb bf` and stopped opening correctly in Excel
 * (contract §2.3 / spec AS-8). `content-disposition` stays stripped like every other upstream header; the
 * export anchor of `/reports/utm` names the file through its `download` attribute.
 */
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'user-agent'] as const
const NOT_PROXIED = new Set(['auth/login'])
/** `application/json`, `application/problem+json`, … — everything else travels as raw bytes */
const JSON_CONTENT_TYPE = /^application\/(?:[\w!#$%&*.^`~-]*\+)?json\b/i

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

  const body = method === 'GET' || method === 'HEAD'
    ? undefined
    : await readBody(event).catch(() => undefined)

  const headers: Record<string, string> = {}
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[name]
    if (value) {
      headers[name] = value
    }
  }
  // `content-type` only travels with a body: Fastify answers 400 to a body-less request that still declares
  // `application/json` (apollo-api FEAT-006 note) — DELETE /proxies/:id and DELETE /browser-profile-defaults/me
  if (body !== undefined && incoming['content-type']) {
    headers['content-type'] = incoming['content-type']
  }
  const ip = getRequestIP(event, { xForwardedFor: true })
  if (ip) {
    headers['x-forwarded-for'] = ip
  }
  if (session.data.token) {
    headers.authorization = `Bearer ${session.data.token}`
  }

  try {
    const res = await $fetch.raw(path, {
      baseURL: apiBase,
      method,
      query: getQuery(event),
      body,
      headers,
      ignoreResponseError: true,
      // never let ofetch decode the body — see the "Body handling" note above
      responseType: 'arrayBuffer'
    })

    setResponseStatus(event, res.status)
    const contentType = res.headers.get('content-type')
    if (contentType) {
      setResponseHeader(event, 'content-type', contentType)
    }

    // `responseType: 'arrayBuffer'` is not reflected in `$fetch.raw`'s generic default (`{}`)
    const buffer = res._data ? Buffer.from(res._data as ArrayBuffer) : null
    if (!buffer?.length) {
      return null
    }
    if (!contentType || JSON_CONTENT_TYPE.test(contentType)) {
      try {
        return JSON.parse(buffer.toString('utf8')) as unknown
      } catch {
        // a JSON content-type with a non-JSON body: hand the text over like ofetch's `destr` would
        return buffer.toString('utf8')
      }
    }
    return buffer
  } catch {
    setResponseStatus(event, 502)
    return { error: 'api unreachable' }
  }
})
