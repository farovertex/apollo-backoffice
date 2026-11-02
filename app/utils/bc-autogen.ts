/**
 * FEAT-097 — Thai texts and the pure helpers the auto-gen modal / chip / panel share (api-contract.md v1 §6,
 * spec "UI behaviour"). Everything here is side-effect free so it is unit-testable: the components only render
 * the strings these functions return.
 * `BC_AUTOGEN_REASON_TEXT` is copied **verbatim** from the API's `BC_AUTOGEN_CONFLICT` (contract §3.5), so the
 * inline notice of a `canStart: false` suggest and the toast of the matching 409 read exactly the same.
 */
import { normalizeBcSubName } from './bc-sub-create'
import type {
  BcAutogenConflictReason,
  BcAutogenRunView,
  BcAutogenSkipReason,
  BcAutogenStopReason
} from '#shared/types/bc-autogen'

export const BC_AUTOGEN_NAME_MAX = 100
export const BC_AUTOGEN_PREFIX_MAX = 97
export const BC_AUTOGEN_ADV_MIN = 1
export const BC_AUTOGEN_ADV_MAX = 50
export const BC_AUTOGEN_ROWS_MIN = 1
export const BC_AUTOGEN_ROWS_MAX = 10
export const BC_AUTOGEN_ADV_DEFAULT = 3
export const BC_AUTOGEN_ROWS_DEFAULT = 3
/** client-side ETA: every step is estimated at 1.5 minutes (A17; the API returns no timing) */
export const BC_AUTOGEN_MINUTES_PER_STEP = 1.5

/** 409 `error` sentences (contract §3.5) — `profileProvisioning` is dynamic, kept here only as a fallback */
export const BC_AUTOGEN_REASON_TEXT: Record<BcAutogenConflictReason, string> = {
  noOrgId: 'บัญชีนี้ยังไม่มี Business Center — กด Sync ก่อน',
  noProfile: 'บัญชีนี้ยังไม่มีโปรไฟล์ที่พร้อมใช้',
  inactive: 'account ถูกปิดใช้งาน',
  runOpen: 'มีงานสร้างอัตโนมัติของบัญชีนี้ทำอยู่แล้ว',
  nameTaken: 'มีชื่อศูนย์ธุรกิจนี้อยู่แล้ว',
  profileProvisioning: 'โปรไฟล์ยังสร้างไม่เสร็จ',
  invalidState: 'งานนี้อยู่ในสถานะที่ทำคำสั่งนี้ไม่ได้',
  nothingToRetry: 'ไม่มีขั้นที่ล้มหรือถูกข้ามให้ลองใหม่'
}

/** Thai sentence of a 409 reason; an unknown code falls back to itself, `null`/empty to a generic sentence. */
export function bcAutogenReasonText(reason: BcAutogenConflictReason | string | null | undefined): string {
  if (!reason) return 'สร้างอัตโนมัติไม่ได้ตอนนี้'
  return (BC_AUTOGEN_REASON_TEXT as Record<string, string>)[reason] ?? reason
}

/** short text for a skipped advertiser / row (panel reason labels) */
export const BC_AUTOGEN_SKIP_TEXT: Record<BcAutogenSkipReason, string> = {
  limitReached: 'เต็มโควตา',
  suspendedAdvertiser: 'มีบัญชีถูกระงับ',
  subFailed: 'ข้าม: สร้าง Sub BC ไม่สำเร็จ',
  orgNotFound: 'ข้าม: หา org ไม่เจอ',
  superseded: 'ข้าม: เริ่มงานใหม่แทน'
}

export function bcAutogenSkipText(reason: BcAutogenSkipReason | string | null | undefined): string {
  if (!reason) return 'ข้าม'
  return (BC_AUTOGEN_SKIP_TEXT as Record<string, string>)[reason] ?? reason
}

/** description of a `stopped` run (the toast + the panel footer) */
export const BC_AUTOGEN_STOP_TEXT: Record<BcAutogenStopReason, string> = {
  human: 'หยุดโดยผู้ใช้',
  notLoggedIn: 'บัญชีหลุด login — กด Login แล้วกดทำต่อ',
  cancelled: 'งานย่อยถูกยกเลิก'
}

export function bcAutogenStopText(reason: BcAutogenStopReason | string | null | undefined): string {
  if (!reason) return ''
  return (BC_AUTOGEN_STOP_TEXT as Record<string, string>)[reason] ?? reason
}

/** `<prefix>` immediately followed by the 1-based `seq` zero-padded to 3 digits (no separator) */
export function advName(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(3, '0')}`
}

/** the structured preview of a row's advertiser names: all names when count ≤ 5, else first 3 + gap + last */
export interface AutogenNamePreview {
  head: string[]
  /** 0 when every name fits in `head` (count ≤ 5), else how many names are hidden between `head` and `tail` */
  more: number
  tail: string | null
}

export function previewNames(prefix: string, count: number): AutogenNamePreview {
  const n = Math.max(0, Math.floor(count))
  if (n <= 5) {
    return { head: Array.from({ length: n }, (_, i) => advName(prefix, i + 1)), more: 0, tail: null }
  }
  return {
    head: [advName(prefix, 1), advName(prefix, 2), advName(prefix, 3)],
    // first 3 + last are shown; everything else is hidden: count − 4
    more: n - 4,
    tail: advName(prefix, n)
  }
}

/** the exact text content of `ta-autogen-preview-<i>` (what AC-14 asserts) */
export function previewText(prefix: string, count: number): string {
  const p = previewNames(prefix, count)
  if (p.more === 0) return p.head.join(' ')
  return `${p.head.join(' ')} … อีก ${p.more} ชื่อ … ${p.tail}`
}

/** how many steps a plan has: 2 per row (sub + discover) + N advertisers + 1 discoverOrg when N ≥ 1 */
export function countSteps(rows: readonly { adv: { count: number } | null }[]): number {
  return rows.reduce((sum, row) => sum + (row.adv ? 2 + row.adv.count + 1 : 2), 0)
}

/** total advertisers of a plan */
export function countAdvertisers(rows: readonly { adv: { count: number } | null }[]): number {
  return rows.reduce((sum, row) => sum + (row.adv ? row.adv.count : 0), 0)
}

/** client-side ETA in minutes for a number of steps (A17) */
export function estimateMinutes(steps: number): number {
  return Math.round(steps * BC_AUTOGEN_MINUTES_PER_STEP)
}

/** human text of an ETA: "H ชม. M นาที" from 60 min on, else "M นาที" */
export function estimateText(steps: number): string {
  const minutes = estimateMinutes(steps)
  if (minutes < 60) return `${minutes} นาที`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} ชม. ${m} นาที` : `${h} ชม.`
}

/** the "current step" phrase of the chip, from `run.current` ("Sub BC 2" / "Sync" / "adv SLD-A003" / "Sync org") */
export function stepText(run: Pick<BcAutogenRunView, 'current' | 'rows'> | null | undefined): string {
  const cur = run?.current
  if (!cur) return ''
  switch (cur.kind) {
    case 'sub':
      return `Sub BC ${cur.rowIdx + 1}`
    case 'discover':
      return 'Sync'
    case 'discoverOrg':
      return 'Sync org'
    case 'adv': {
      const item = run?.rows?.[cur.rowIdx]?.adv?.items.find(i => i.seq === cur.seq)
      return item ? `adv ${item.name}` : 'adv'
    }
    default:
      return ''
  }
}

// ── inline validation (pure; the modal renders what these return, `null` = the field is valid) ──────────────────────

/** validation messages (spec "UI behaviour → Modal") */
export const BC_AUTOGEN_VALIDATION = {
  nameEmpty: 'ต้องใส่ชื่อ',
  nameUsed: 'มีชื่อนี้แล้วใน Business Center',
  nameDuplicate: 'ชื่อซ้ำกับแถวอื่นในรายการนี้',
  nameTooLong: 'ชื่อยาวได้ไม่เกิน 100 ตัวอักษร',
  prefixEmpty: 'ต้องใส่ prefix',
  prefixTooLong: 'prefix ยาวได้ไม่เกิน 97 ตัวอักษร',
  countRange: 'จำนวน 1–50'
} as const

function normLower(name: string): string {
  return normalizeBcSubName(name).toLowerCase()
}

/** true when the typed name is in the login's used-names set (trim + collapse + case-insensitive, like the API) */
export function isAutogenNameUsed(name: string, used: readonly string[]): boolean {
  const needle = normLower(name)
  if (!needle) return false
  return used.some(u => normLower(u) === needle)
}

/**
 * Inline error of one row's name field, `null` when valid. `allNames` is every row's raw name in plan order;
 * a duplicate is flagged on the **later** row only (an earlier row with the same name keeps its field clean,
 * matching the API's "later index" rule), so two rows with one name show exactly one error.
 */
export function autogenNameError(
  name: string,
  idx: number,
  allNames: readonly string[],
  used: readonly string[]
): string | null {
  const norm = normalizeBcSubName(name)
  if (!norm) return BC_AUTOGEN_VALIDATION.nameEmpty
  if (norm.length > BC_AUTOGEN_NAME_MAX) return BC_AUTOGEN_VALIDATION.nameTooLong
  if (isAutogenNameUsed(name, used)) return BC_AUTOGEN_VALIDATION.nameUsed
  const needle = norm.toLowerCase()
  for (let j = 0; j < idx; j++) {
    if (normLower(allNames[j] ?? '') === needle) return BC_AUTOGEN_VALIDATION.nameDuplicate
  }
  return null
}

/** inline error of a row's prefix field (only when adv is on), `null` when valid */
export function autogenPrefixError(prefix: string, advOn: boolean): string | null {
  if (!advOn) return null
  const trimmed = prefix.trim()
  if (!trimmed) return BC_AUTOGEN_VALIDATION.prefixEmpty
  if (trimmed.length > BC_AUTOGEN_PREFIX_MAX) return BC_AUTOGEN_VALIDATION.prefixTooLong
  return null
}

/** inline error of a row's advertiser-count field (only when adv is on), `null` when valid */
export function autogenCountError(count: number, advOn: boolean): string | null {
  if (!advOn) return null
  if (!Number.isInteger(count) || count < BC_AUTOGEN_ADV_MIN || count > BC_AUTOGEN_ADV_MAX) {
    return BC_AUTOGEN_VALIDATION.countRange
  }
  return null
}
