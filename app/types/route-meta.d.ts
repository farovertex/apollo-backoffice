export {}

declare module '#app' {
  interface PageMeta {
    /** `false` = public page (no session required). Default: protected. See app/middleware/auth.global.ts */
    auth?: boolean
  }
}

declare module 'vue-router' {
  interface RouteMeta {
    auth?: boolean
  }
}
