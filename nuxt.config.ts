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
