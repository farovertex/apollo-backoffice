/**
 * FEAT-003 — `/tiktok-accounts` (apollo-api, functions 3.1 + 3.3 + delete from 3.2). Mirrors
 * mission-control/.ai/features/FEAT-003-tiktok-accounts/api-contract.md v1 ("Account view").
 * `password` is plaintext by human decision (2026-09-22): the BO masks it and never logs / screenshots it.
 */

export type SessionStatus = 'unknown' | 'loggedIn' | 'loggedOut' | 'needsHuman' | 'disabled'

/** Populated browser profile (subset of BROWSER_PROFILES); `null` on the account view if the profile row is gone. */
export interface AccountBrowserProfile {
  id: string
  name: string
  providerProfileId: string
  groupName: string | null
}

export interface TikTokAccount {
  id: string
  workspaceId: string
  browserProfileId: string
  browserProfile: AccountBrowserProfile | null
  label: string | null
  loginEmail: string
  password: string
  sessionStatus: SessionStatus
  isActive: boolean
  /** ISO | null — stays null until session check (3.4) exists */
  lastSessionCheckAt: string | null
  /** ISO | null — stays null until login (3.5) exists */
  lastLoginAt: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** `GET /tiktok-accounts` 200 body (sorted `createdAt` desc, no pagination). */
export interface AccountsResponse {
  count: number
  accounts: TikTokAccount[]
}

/** `POST /tiktok-accounts` body (`createTikTokAccountSchema`). `label` omitted or empty → null. */
export interface CreateAccountBody {
  loginEmail: string
  password: string
  browserProfileId: string
  label?: string
}
