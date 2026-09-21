import type { H3Event } from 'h3'
import type { ApiErrorBody } from '#shared/types/auth'

export interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: Record<string, unknown>
  query?: Record<string, unknown>
  headers?: Record<string, string>
  /** `undefined` = bearer token from the sealed session · `null` = send no Authorization (e.g. login) */
  token?: string | null
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  return !!value && typeof value === 'object' && typeof (value as ApiErrorBody).error === 'string'
}

/**
 * Server → apollo-api call. Uses runtimeConfig.apiBase and the session's bearer token when present.
 * API errors are re-thrown as h3 errors: `createError({ statusCode, data: { error, issues? } })`
 * so handlers can pass status + body through unchanged (see sendApiError).
 */
export async function apiFetch<T>(event: H3Event, path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const { apiBase } = useRuntimeConfig(event)

  let token = opts.token
  if (token === undefined) {
    const session = await getApiSession(event)
    token = session.data.token ?? null
  }

  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers }
  if (token) {
    headers.authorization = `Bearer ${token}`
  }

  try {
    // apollo-api routes are not in Nitro's typed route map → plain cast to the caller's T
    const data: unknown = await $fetch(path, {
      baseURL: apiBase,
      method: opts.method ?? 'GET',
      body: opts.body,
      query: opts.query,
      headers
    })
    return data as T
  } catch (err) {
    throw toApiError(err)
  }
}

/** Normalise anything thrown around an API call (ofetch FetchError, h3 error, network failure) into an h3 error with `{ error }` data. */
export function toApiError(err: unknown) {
  const e = err as { statusCode?: number, status?: number, data?: unknown, message?: string } | null
  const statusCode = e?.statusCode ?? e?.status

  if (typeof statusCode === 'number' && statusCode >= 400) {
    return createError({
      statusCode,
      data: isApiErrorBody(e?.data) ? e.data : { error: e?.message || `api error ${statusCode}` }
    })
  }

  return createError({ statusCode: 502, data: { error: 'api unreachable' } })
}

/** Answer with the API's status and its `{ error }` body (not h3's `{ statusCode, message, … }` envelope). */
export function sendApiError(event: H3Event, err: unknown): ApiErrorBody {
  const e = toApiError(err)
  setResponseStatus(event, e.statusCode)
  return isApiErrorBody(e.data) ? e.data : { error: e.message }
}
