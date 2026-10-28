/**
 * FEAT-076 — prefix helpers shared by `/settings/prefixes`, `/tiktok-accounts` and the three account modals.
 */
import type { PrefixRef, PrefixView } from '#shared/types/prefixes'

/** api-contract §3 — `name` is trimmed ≤ 100 (`PREFIX_MESSAGES.nameTooLong`); the API stays the authority */
export const PREFIX_NAME_MAX_LENGTH = 100

/** Thai status labels of the spec (`st-prefix-status`, `ta-prefix-archived`, the Edit modal suffix) */
export const PREFIX_STATUS_LABEL = {
  active: 'ใช้งาน',
  archived: 'เก็บถาวร'
} as const

/** picker label: `code — name`, or the code alone when the prefix has no name */
export function prefixLabel(prefix: Pick<PrefixRef | PrefixView, 'code' | 'name'>): string {
  return prefix.name ? `${prefix.code} — ${prefix.name}` : prefix.code
}

/** spec AC-15 — the text of `ta-add-prefix-empty` / `ta-batch-prefix-empty` */
export const PREFIX_EMPTY_PICK = 'ยังไม่มี prefix ที่คุณดูแล — ขอให้ GOD เพิ่มคุณเข้า prefix ก่อน'
/** spec AC-15 — zod message when nothing was picked */
export const PREFIX_REQUIRED = 'กรุณาเลือก prefix'
