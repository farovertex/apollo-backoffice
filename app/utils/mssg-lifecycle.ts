/**
 * FEAT-101 M5 (B5; spec AC-33..37, D6; api-contract.md §4.1–§4.3, §4.6) — pure helpers and Thai texts of the site
 * lifecycle: own domain (hostname rule, state texts), duplicate, delete website (exact-name match), and which site
 * job a failure / progress line belongs to. The API stays the authority (its 400 / 403 / 409 are shown as they come).
 */
import type { MssgSite } from '#shared/types/mssg-accounts'
import type { MssgSiteDomain } from '#shared/types/mssg-sites'

/** site job types started from editor step 1 (contract §5) */
export const MSSG_LIFECYCLE_JOB_TYPES = ['mssgSiteDuplicate', 'mssgSiteDelete', 'mssgDomain'] as const
export type MssgLifecycleJobType = typeof MSSG_LIFECYCLE_JOB_TYPES[number]

export function mssgIsLifecycleJob(type: string | null | undefined): type is MssgLifecycleJobType {
  return !!type && (MSSG_LIFECYCLE_JOB_TYPES as readonly string[]).includes(type)
}

export const MSSG_LIFECYCLE_TEXT = {
  duplicate: 'ทำสำเนาเว็บ (Duplicate website)',
  duplicateConfirmTitle: 'ทำสำเนาเว็บนี้?',
  duplicateConfirm: (name: string) => `mssg จะสร้างเว็บใหม่ "${name} Copy" ในบัญชีเดียวกัน (หน้า block และการตั้งค่าเหมือนเว็บนี้ตามที่อยู่บน mssg ตอนนี้ · ร่างที่ยังไม่บันทึกจะไม่ถูกคัดลอก) · ฟีเจอร์นี้ต้องใช้แพ็กเกจ Business ของ mssg`,
  duplicateOk: 'ทำสำเนาเสร็จแล้ว',
  duplicateFailed: 'ทำสำเนาเว็บไม่สำเร็จ',
  delete: 'ลบเว็บ (Delete website)',
  deleteTitle: 'ลบเว็บนี้ถาวร?',
  deleteWarn: 'เว็บ หน้า block สินค้า และข้อมูลทั้งหมดของเว็บนี้บน mssg จะถูกลบ ย้อนกลับไม่ได้ ร่างใน Apollo จะถูกลบด้วย',
  deleteType: 'พิมพ์ชื่อเว็บให้ตรงทุกตัวอักษรเพื่อยืนยัน',
  deleteMismatch: 'ชื่อยังไม่ตรง (ต้องตรงทุกตัวอักษร รวมตัวพิมพ์เล็ก-ใหญ่)',
  deleteOk: 'ลบเว็บแล้ว',
  deleteFailed: 'ลบเว็บไม่สำเร็จ',
  domainFailed: 'ตั้งค่าโดเมนไม่สำเร็จ',
  domainTitle: 'โดเมนของคุณเอง (ไม่บังคับ)',
  domainTip: 'Pro Tip: ใส่โดเมนที่ต้องการเชื่อม ถ้ามีเว็บหลักอยู่แล้วใช้ subdomain ได้ เช่น mssg.example.com · ซื้อโดเมนได้ที่ godaddy.com, namecheap.com, nic.ua หรือผู้ขายโดเมนอื่น',
  domainConnect: 'เชื่อมโดเมน (Connect domain)',
  domainCheck: 'ตรวจสอบอีกครั้ง',
  domainDisconnect: 'ยกเลิกการเชื่อมโดเมน',
  domainDisconnectTitle: 'ยกเลิกการเชื่อมโดเมนนี้?',
  domainDisconnectBody: (name: string) => `เว็บจะกลับไปใช้ลิงก์ของ mssg และ ${name} จะไม่เปิดเว็บนี้อีก (ตั้งค่า DNS ที่ผู้ขายโดเมนไม่ถูกแก้)`,
  domainSame: 'โดเมนนี้เชื่อมอยู่แล้ว · กด "ตรวจสอบอีกครั้ง" เพื่ออ่านสถานะล่าสุด',
  domainNeverRead: 'ยังไม่เคยอ่านสถานะโดเมนของเว็บนี้ · กด "ตรวจสอบอีกครั้ง" เพื่ออ่านจาก mssg'
} as const

// ── own domain (contract §4.6) ───────────────────────────────────────────────────────────────────────────────────────
const APEX = ['mssg.me', 'stick.ws', 'linksbio.site', 'lnkbio.site', 'shopbio.site']
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** what is sent: trimmed and lower-cased (DNS names are case-insensitive) */
export function mssgNormalizeHostname(v: string): string {
  return v.trim().toLowerCase()
}

/** Thai message for an invalid own domain, or `null` (hostname 4–253, ≥ 1 dot, not one of the 5 mssg apex domains) */
export function mssgDomainIssue(raw: string): string | null {
  const v = mssgNormalizeHostname(raw)
  if (!v) return 'ใส่โดเมนก่อน เช่น shop.yourbrand.com'
  if (/[/:@\s]/.test(v)) return 'ใส่เฉพาะชื่อโดเมน ไม่ต้องมี https:// ช่องว่าง หรือ / เช่น shop.yourbrand.com'
  if (v.length < 4 || v.length > 253) return 'โดเมนต้องยาว 4–253 ตัวอักษร'
  const labels = v.split('.')
  if (labels.length < 2) return 'โดเมนต้องมีจุดอย่างน้อย 1 จุด เช่น shop.yourbrand.com'
  if (!labels.every(l => LABEL_RE.test(l))) return 'โดเมนใช้ได้เฉพาะ a-z ตัวเลข ขีด (-) และจุดคั่น เช่น shop.yourbrand.com'
  if (!/^[a-z]{2,63}$/.test(labels[labels.length - 1]!) && !/^xn--[a-z0-9-]+$/.test(labels[labels.length - 1]!)) return 'นามสกุลโดเมนไม่ถูกต้อง เช่น .com .co.th'
  if (APEX.some(a => v === a || v.endsWith(`.${a}`))) return 'ใช้โดเมนของ mssg ไม่ได้ ตั้งลิงก์ของ mssg ได้ที่ "ลิงก์เว็บ" ด้านบน'
  return null
}

export type MssgDomainState = MssgSiteDomain['state']

export const MSSG_DOMAIN_STATE: Record<MssgDomainState, { label: string, color: 'neutral' | 'warning' | 'success' | 'error', hint: string }> = {
  none: { label: 'ยังไม่ได้เชื่อม (none)', color: 'neutral', hint: '' },
  pending: { label: 'รอตั้งค่า DNS (pending)', color: 'warning', hint: 'ตั้งค่า DNS ตามตารางด้านล่างที่ผู้ขายโดเมน แล้วกด "ตรวจสอบอีกครั้ง" · DNS อาจใช้เวลาหลายชั่วโมงกว่าจะมีผล' },
  active: { label: 'ใช้งานได้ (active)', color: 'success', hint: 'โดเมนนี้เปิดเว็บนี้ได้แล้ว' },
  error: { label: 'ตั้งค่าไม่สำเร็จ (error)', color: 'error', hint: 'mssg ยังตรวจไม่พบค่า DNS ที่ถูกต้อง ตรวจค่าในตารางด้านล่างที่ผู้ขายโดเมน แล้วกด "ตรวจสอบอีกครั้ง"' }
}

export function mssgDomainStateOf(d: MssgSiteDomain | null | undefined): MssgDomainState | null {
  if (!d) return null
  return (d.state in MSSG_DOMAIN_STATE ? d.state : 'error') as MssgDomainState
}

// ── delete website (contract §4.3: exact, case-sensitive, after trimming both sides) ────────────────────────────────
export function mssgDeleteNameMatches(typed: string, siteName: string): boolean {
  return typed.trim() !== '' && typed.trim() === siteName.trim()
}

// ── duplicate: the copy = a site of the account that was not there before (contract §4.2: no `job.result`) ───────────
export function mssgNewSites(before: string[] | null | undefined, after: MssgSite[]): MssgSite[] {
  if (!before) return []
  return after.filter(x => !!x.id && !before.includes(x.id))
}

/** Thai title of a failed lifecycle job */
export function mssgLifecycleFailTitle(type: string | null | undefined): string {
  if (type === 'mssgSiteDuplicate') return MSSG_LIFECYCLE_TEXT.duplicateFailed
  if (type === 'mssgSiteDelete') return MSSG_LIFECYCLE_TEXT.deleteFailed
  if (type === 'mssgDomain') return MSSG_LIFECYCLE_TEXT.domainFailed
  return 'งานไม่สำเร็จ'
}
