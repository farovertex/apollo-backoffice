/**
 * Fail fast at startup when NUXT_SESSION_PASSWORD is missing or too short — a weak/empty secret would make the
 * sealed session cookie forgeable. Nitro re-throws plugin errors, so the server refuses to start.
 */
export default defineNitroPlugin(() => {
  assertSessionPassword(useRuntimeConfig().session.password)
})
