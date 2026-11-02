/**
 * GET /backend/notifications/stream  →  ${NUXT_API_BASE}/notifications/stream   (FEAT-095, api-contract §6)
 *
 * A copy of `server/routes/backend/topups/stream.get.ts`: the catch-all proxy buffers the body with `$fetch.raw`,
 * which an SSE stream never survives, so this sibling route pipes the upstream body through unbuffered. Unlike the
 * topups route it forwards **no query** — the notifications stream is scoped to the caller (`adminId`) on the API,
 * there is no `workspaceId` filter.
 *
 *   - `Authorization: Bearer` comes from the sealed session cookie; a client-supplied one is dropped
 *   - only `accept`, `accept-language`, `user-agent` and `x-forwarded-for` travel upstream
 *   - of the upstream response only the status and the body are passed on — no `set-cookie`, no caching
 *   - the browser closing the EventSource aborts the upstream request (no leaked change-stream listener)
 *   - the upstream dying mid-stream ends the browser's connection too, so `useNotifications` falls back to polling
 *   - a non-stream answer (503 "not a replica set", 401, 403, 404) is passed through with its JSON body so
 *     `useNotifications` can fall back to polling
 *
 * Nitro matches this static route before the `[...path]` wildcard, so nothing about the catch-all changes.
 */
const FORWARDED_REQUEST_HEADERS = ['accept', 'accept-language', 'user-agent'] as const

export default defineEventHandler(async (event) => {
  const { apiBase } = useRuntimeConfig(event)
  const session = await getApiSession(event)

  const base = apiBase.endsWith('/') ? apiBase : `${apiBase}/`
  const url = new URL('notifications/stream', base)

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
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'connection', 'keep-alive')
  setResponseHeader(event, 'x-accel-buffering', 'no')

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
