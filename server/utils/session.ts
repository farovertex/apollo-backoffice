import type { H3Event } from 'h3'
import type { AuthAdmin } from '#shared/types/auth'

/**
 * Sealed session cookie (h3 useSession → iron-webcrypto, built into Nitro).
 * The apollo-api bearer token lives ONLY inside the sealed payload: httpOnly cookie, encrypted + signed with
 * NUXT_SESSION_PASSWORD, so neither JS in the browser nor anyone reading the cookie can recover it.
 */
export type ApiSessionData = {
  token?: string
  expiresAt?: string
  admin?: AuthAdmin
}

/** 7 days — matches apollo-api SESSION_TTL_MS */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
export const SESSION_PASSWORD_MIN_LENGTH = 32

export function assertSessionPassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < SESSION_PASSWORD_MIN_LENGTH) {
    throw new Error(
      `[apollo-bo] NUXT_SESSION_PASSWORD must be set and at least ${SESSION_PASSWORD_MIN_LENGTH} characters long `
      + '(secret used to seal the httpOnly session cookie). See README.md → "Auth & API integration".'
    )
  }
}

/** Cookie attributes shared by the session manager and the logout handler (deleting cookie must match name + path). */
export function sessionCookieOptions(event: H3Event) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: getRequestProtocol(event) === 'https',
    path: '/'
  }
}

/** Session manager for this request: `.data` (unsealed), `.update({...})`, `.clear()`. */
export function getApiSession(event: H3Event) {
  const config = useRuntimeConfig(event)
  assertSessionPassword(config.session.password)

  return useSession<ApiSessionData>(event, {
    name: config.session.name,
    password: config.session.password,
    maxAge: SESSION_MAX_AGE_SECONDS,
    // cookie only — never accept the session from a request header
    sessionHeader: false,
    cookie: sessionCookieOptions(event)
  })
}

/** Keep only what the BO needs in the cookie (small cookie, no surprises if the API adds fields). */
export function pickSessionAdmin(admin: Record<string, unknown>): AuthAdmin {
  return {
    id: String(admin.id ?? ''),
    username: String(admin.username ?? ''),
    displayName: String(admin.displayName ?? admin.username ?? ''),
    roles: Array.isArray(admin.roles) ? (admin.roles as AuthAdmin['roles']) : [],
    homeWorkspaceId: typeof admin.homeWorkspaceId === 'string' ? admin.homeWorkspaceId : null
  }
}
