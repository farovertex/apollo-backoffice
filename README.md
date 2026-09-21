# Nuxt Dashboard Template

[![Nuxt UI](https://img.shields.io/badge/Made%20with-Nuxt%20UI-00DC82?logo=nuxt&labelColor=020420)](https://ui.nuxt.com)

Get started with the Nuxt dashboard template with multiple pages, collapsible sidebar, keyboard shortcuts, light & dark mode, command palette and more, powered by [Nuxt UI](https://ui.nuxt.com).

- [Live demo](https://dashboard-template.nuxt.dev/)
- [Documentation](https://ui.nuxt.com/docs/getting-started/installation/nuxt)

<a href="https://dashboard-template.nuxt.dev/" target="_blank">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://ui.nuxt.com/assets/templates/nuxt/dashboard-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://ui.nuxt.com/assets/templates/nuxt/dashboard-light.png">
    <img alt="Nuxt Dashboard Template" src="https://ui.nuxt.com/assets/templates/nuxt/dashboard-light.png">
  </picture>
</a>

> The dashboard template for Vue is on https://github.com/nuxt-ui-templates/dashboard-vue.

## Quick Start

```bash [Terminal]
npm create nuxt@latest -- -t ui/dashboard
```

## Deploy your own

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-name=dashboard&repository-url=https%3A%2F%2Fgithub.com%2Fnuxt-ui-templates%2Fdashboard&demo-image=https%3A%2F%2Fui.nuxt.com%2Fassets%2Ftemplates%2Fnuxt%2Fdashboard-dark.png&demo-url=https%3A%2F%2Fdashboard-template.nuxt.dev%2F&demo-title=Nuxt%20Dashboard%20Template&demo-description=A%20dashboard%20template%20with%20multi-column%20layout%20for%20building%20sophisticated%20admin%20interfaces.)

## Setup

Make sure to install the dependencies:

```bash
pnpm install
```

## Development Server

Start the development server on `http://localhost:3000`:

```bash
pnpm dev
```

## Production

Build the application for production:

```bash
pnpm build
```

Locally preview production build:

```bash
pnpm preview
```

Check out the [deployment documentation](https://nuxt.com/docs/getting-started/deployment) for more information.

## Auth & API integration

The backoffice talks to `apollo-api` only through its own Nitro server. The browser never sees the API origin or the API token.

```
browser ──(same origin)──▶ Nitro (this app) ──(NUXT_API_BASE + Authorization: Bearer)──▶ apollo-api
   │  cookie: apollo-bo-session (sealed, httpOnly)                    ▲
   └──────────────── the token lives only inside the sealed cookie ───┘
```

### Prefixes

| prefix | what | owner |
|---|---|---|
| `/backend/**` | proxy → `${NUXT_API_BASE}/**` (`server/routes/backend/[...path].ts`). Forwards method, query, JSON body; injects the session's bearer token; passes status + body through (`{ error }` preserved); strips upstream headers such as `set-cookie`. `auth/login` is not proxied because its response carries the token. | apollo-api contract |
| `/api/auth/*` | BO-owned auth endpoints (`login.post.ts`, `me.get.ts`, `logout.post.ts`) — Nitro handlers that manage the sealed session. | this app |
| `/api/*` (other) | the dashboard template's mock data (`customers`, `mails`, `members`, `notifications`). Untouched; will be replaced page by page. | template |

### Session design

- **Login** — `POST /api/auth/login { username, password }` → Nitro calls `POST /auth/login` on apollo-api, stores `{ token, expiresAt, admin }` in an h3 `useSession()` cookie (iron-webcrypto seal: encrypted + signed with `NUXT_SESSION_PASSWORD`) and returns `{ admin }` only.
- **Every API call** — `useApi()` (`$fetch.create({ baseURL: '/backend', credentials: 'include' })`) → the proxy unseals the cookie and adds `Authorization: Bearer …` server-side. A 401 from the API clears the auth state and redirects to `/login?redirect=…`.
- **Session check** — `useAuth().fetchMe()` → `GET /api/auth/me` validates the token against `GET /auth/me` (revoked/expired sessions are detected on every navigation), returns `{ admin, context }`, and clears the cookie on 401.
- **Logout** — `POST /api/auth/logout` revokes the API session and clears the cookie (204).
- **Route protection** — `app/middleware/auth.global.ts` protects every page; opt out with `definePageMeta({ auth: false })` (only `/login` today). Redirect targets must be same-origin paths (`app/utils/redirect.ts`).
- **Cookie** — `NUXT_SESSION_NAME` (default `apollo-bo-session`), httpOnly, `sameSite=lax`, `secure` when the request is https, `maxAge` 7 days (= apollo-api session TTL), path `/`. The session is only read from the cookie, never from a header.

### Why a sealed cookie instead of a bearer token in localStorage

- The token is never exposed to JavaScript: no XSS exfiltration, nothing to leak into console logs, screenshots, Playwright traces or bug reports.
- `httpOnly` + `sameSite=lax` gives CSRF protection for state-changing calls made from other sites, and the browser handles expiry.
- No client-side token refresh or storage code; SSR can render protected pages directly because the cookie travels with the first request (no flash of the login page).
- It needs no extra dependency and no server-side session store: the cookie *is* the store (the API already keeps the revocation list).

### Tradeoffs

- One extra hop per API call (browser → Nitro → API), ~1 ms locally; the proxy re-serialises JSON bodies (no streaming of large uploads yet).
- Cookie size ≈ 300–400 bytes (token + small admin object); do not put more into the session.
- Changing `NUXT_SESSION_PASSWORD` invalidates every session; rotating it means everyone logs in again. The value must be at least 32 characters — the server refuses to start otherwise (`server/plugins/session-config.ts`).
- The API token in the cookie can outlive the API session (7 days vs revocation); `GET /api/auth/me` catches that and clears the cookie on the next navigation.
- Cookies are per-origin: a BO deployed on another host than the API is fine (the proxy is same-origin), but two BO instances on the same host share the cookie name unless `NUXT_SESSION_NAME` differs.

### Environment

| variable | default | notes |
|---|---|---|
| `NUXT_API_BASE` | `http://localhost:3001` | apollo-api base URL (server-side only) |
| `NUXT_SESSION_PASSWORD` | – | **required**, ≥ 32 chars; seals the session cookie |
| `NUXT_SESSION_NAME` | `apollo-bo-session` | cookie name |

`pnpm dev:start <profile>` in `mission-control` injects all three (a per-run password unless `BO_SESSION_PASSWORD` is set in its `.env`).

## Renovate integration

Install [Renovate GitHub app](https://github.com/apps/renovate/installations/select_target) on your repository and you are good to go.
