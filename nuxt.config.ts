// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui',
    '@vueuse/nuxt'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // deploy/build-release.mjs builds each release into its own folder with its own build dir, so a deploy never
  // deletes the `.output` the running server reads nor the `.nuxt` of a dev server. Unset = the Nuxt defaults.
  // BO_RELEASE_CARRY_DIR = client chunks of the previous releases: Nitro serves only files in its build-time asset
  // manifest, so they must be part of the build for tabs opened before a deploy to keep lazy-loading pages.
  ...(process.env.BO_RELEASE_BUILD_DIR ? { buildDir: process.env.BO_RELEASE_BUILD_DIR } : {}),
  ...(process.env.BO_RELEASE_OUTPUT_DIR
    ? {
        nitro: {
          output: { dir: process.env.BO_RELEASE_OUTPUT_DIR },
          ...(process.env.BO_RELEASE_CARRY_DIR
            ? { publicAssets: [{ dir: process.env.BO_RELEASE_CARRY_DIR, baseURL: '/_nuxt', maxAge: 31_536_000 }] }
            : {})
        }
      }
    : {}),

  // Server-only (never sent to the browser). Override with env: NUXT_API_BASE, NUXT_SESSION_NAME, NUXT_SESSION_PASSWORD.
  // See README.md → "Auth & API integration". NUXT_SESSION_PASSWORD (>= 32 chars) is validated at startup
  // by server/plugins/session-config.ts and again on every session access (server/utils/session.ts).
  runtimeConfig: {
    apiBase: 'http://localhost:3001',
    session: {
      name: 'apollo-bo-session',
      password: ''
    }
  },

  routeRules: {
    '/api/**': {
      cors: true
    }
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
