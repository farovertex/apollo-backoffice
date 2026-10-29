/**
 * FEAT-077 — Telegram QR group per prefix (mission-control/.ai/features/FEAT-077-…/api-contract.md v1 §4, §5, §10).
 */

/** `GET /telegram/status` 200 (GOD / Admin / Payment) — same sources as `GET /settings/telegram` without `updatedAt` */
export interface TelegramStatus {
  enabled: boolean
  configured: boolean
  botUsername: string | null
}

/** `POST /prefixes/:id/telegram/link` 200 — the `startgroup` deep link and when its code dies */
export interface TelegramLinkResponse {
  /** `https://t.me/<botUsername>?startgroup=<32 hex>` */
  url: string
  /** ISO — `TELEGRAM_LINK_TTL_MS` (15 min) after the request */
  expiresAt: string
}
