/**
 * Only same-origin absolute paths are honoured as a post-login redirect: must start with a single `/`
 * (rejects `//evil`, `/\evil`, `http://…`, empty values). Returns null when unusable.
 */
export function safeRedirectPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    return null
  }
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
    return null
  }
  if (value === '/login' || value.startsWith('/login?')) {
    return null
  }
  return value
}
