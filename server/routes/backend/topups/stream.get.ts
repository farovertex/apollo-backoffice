/**
 * GET /backend/topups/stream  →  ${NUXT_API_BASE}/topups/stream   (FEAT-021, api-contract v1.1 §A, gap F-1)
 *
 * The catch-all proxy (`server/routes/backend/[...path].ts`) reads the upstream answer with `$fetch.raw`,
 * which **buffers the whole body** — an SSE stream would never reach the browser. This sibling route is the
 * only exception: same session/bearer injection and the same header stripping, but the upstream body is
 * piped through unbuffered.
 *
 *   - `Authorization: Bearer` comes from the sealed session cookie; a client-supplied one is dropped
 *   - only `accept`, `accept-language`, `user-agent` and `x-forwarded-for` travel upstream
 *   - of the upstream response only the status and the body are passed on — no `set-cookie`, no caching
 *   - the browser closing the EventSource aborts the upstream request (no leaked change-stream listener)
 *   - the upstream dying mid-stream ends the browser's connection too, so `useTopupsLive` falls back to polling
 *   - a non-stream answer (503 "not a replica set", 401, 403, 404) is passed through with its JSON body so
 *     `useTopupsLive` can fall back to polling (v1.1 §B)
 *
 * Nitro matches this static route before the `[...path]` wildcard, so nothing about the catch-all changes.
 */
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'user-agent'] as const
/** every query key the API accepts on this route (api-contract §4) */
const FORWARDED_QUERY = ['workspaceId'] as const

export default defineEventHandler(async (event) => {
  const { apiBase } = useRuntimeConfig(event)
  const session = await getApiSession(event)

  const base = apiBase.endsWith('/') ? apiBase : `${apiBase}/`
  const url = new URL('topups/stream', base)
  const query = getQuery(event)
  for (const key of FORWARDED_QUERY) {
    const value = query[key]
    if (typeof value === 'string' && value !== '') url.searchParams.set(key, value)
  }

  const incoming = getRequestHeaders(event)
  const headers: Record<string, string> = { accept: 'text/event-stream' }
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = incoming[name]
    if (value) headers[name] = value
  }
  const ip = getRequestIP(event, { xForwardedFor: true })
  if (ip) headers['x-forwarded-for'] = ip
  if (session.data.token) headers.authorization = `Bearer ${session.data.token}`

  // the client going away (EventSource.close(), tab closed, reload) must close the upstream request too
  const controller = new AbortController()
  const abort = () => controller.abort()
  event.node.req.on('close', abort)
  event.node.req.on('aborted', abort)

  let upstream: Response
  try {
    upstream = await fetch(url, { headers, signal: controller.signal, redirect: 'manual' })
  } catch {
    setResponseStatus(event, 502)
    return { error: 'api unreachable' }
  }

  const contentType = upstream.headers.get('content-type') ?? ''

  // not a stream → pass status + JSON body through (503 when Mongo is not a replica set, 401/403/404, …)
  if (!upstream.ok || !upstream.body || !contentType.includes('text/event-stream')) {
    setResponseStatus(event, upstream.status)
    setResponseHeader(event, 'content-type', 'application/json')
    const text = await upstream.text().catch(() => '')
    try {
      return JSON.parse(text) as unknown
    } catch {
      return { error: text || `api error ${upstream.status}` }
    }
  }

  setResponseStatus(event, 200)
  setResponseHeader(event, 'content-type', 'text/event-stream; charset=utf-8')
  // no buffering anywhere between the API and the browser
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'connection', 'keep-alive')
  setResponseHeader(event, 'x-accel-buffering', 'no')

  // `sendStream` ends the response when the upstream body ends, but **rejects** when the upstream dies
  // mid-stream (API restarted / killed). Without the catch + end() the browser would keep a half-open
  // EventSource, never fire `onerror` and never fall back to polling — so the connection is always closed here.
  try {
    await sendStream(event, upstream.body)
  } catch {
    // upstream disappeared; nothing left to forward
  } finally {
    controller.abort()
    if (!event.node.res.writableEnded) {
      event.node.res.end()
    }
  }
})
