/**
 * FEAT-101 M2 reopen (B2r; api-contract.md v1.6 §3.4, AC-46, AC-47) — block actions and Messengers platform → type pairs
 * (Link / Features icons: `mssg-glyphs.ts`, v1.9). Pure helpers (explicit imports, no Nuxt auto-imports) so `tests/unit/mssg-reopen.test.ts` can run them.
 *
 * Actions (`Link.items[].action` since v1.9, `Image.action`, `ImageGallery.images[].action`), contract §3.4:
 * - `url` `{ type, url }` http/https ≤ 2 000 · `page` `{ type, page }` a page of the preview (real or temp id)
 * - `tel` / `sms` `{ type, url: "<phone>" }` raw `^\+?[0-9 ()-]{3,30}$` (⚠K18, no `tel:` prefix)
 * - `email` `{ type, url: "<address>" }` raw address ≤ 254 (⚠K18, no `mailto:` prefix)
 * - `anchor` `{ type, anchor: { page, block } }` a block **on that page** of the preview (real or temp ids)
 * - Image / gallery only: `nothing` `{ type }` (default) · `fullImage` `{ type }`
 * An action type read from mssg that is none of these is kept exactly as read (shown, not editable).
 */
import type { MssgPageProjection, MssgSiteProjection } from '../../shared/types/mssg-sites'

// ── actions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export const MSSG_LINK_ACTION_TYPES = ['url', 'page', 'tel', 'email', 'sms', 'anchor'] as const
export const MSSG_IMAGE_ACTION_TYPES = ['nothing', 'fullImage', ...MSSG_LINK_ACTION_TYPES] as const
export type MssgActionType = typeof MSSG_IMAGE_ACTION_TYPES[number]

export const MSSG_ACTION_LABEL: Record<MssgActionType, string> = {
  nothing: 'ไม่ทำอะไร (No action)',
  fullImage: 'เปิดรูปเต็ม (Full image)',
  url: 'เปิดลิงก์ (Open link)',
  page: 'เปิดหน้าภายใน (Internal page)',
  tel: 'โทรออก (Call)',
  email: 'ส่งอีเมล (Send email)',
  sms: 'ส่ง SMS (Send SMS)',
  anchor: 'ไปที่ block (Anchor)'
}

/** label + placeholder of the value input of the types that carry `url` */
export const MSSG_ACTION_VALUE: Record<'url' | 'tel' | 'email' | 'sms', { label: string, placeholder: string, inputmode: 'text' | 'tel' | 'email' }> = {
  url: { label: 'ปลายทาง', placeholder: 'https://...', inputmode: 'text' },
  tel: { label: 'เบอร์โทร', placeholder: '+66 81 234 5678', inputmode: 'tel' },
  sms: { label: 'เบอร์ที่จะส่ง SMS', placeholder: '+66 81 234 5678', inputmode: 'tel' },
  email: { label: 'อีเมลปลายทาง', placeholder: 'name@example.com', inputmode: 'email' }
}

export const MSSG_PHONE_RE = /^\+?[0-9 ()-]{3,30}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** contract §3.2 ids: real mssg ids or temp ids (the synthetic `<tmp>:<n>` ids of a page cloned in the draft are neither) */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export function mssgIsLinkActionType(t: unknown): t is typeof MSSG_LINK_ACTION_TYPES[number] {
  return (MSSG_LINK_ACTION_TYPES as readonly unknown[]).includes(t)
}
export function mssgIsImageActionType(t: unknown): t is MssgActionType {
  return (MSSG_IMAGE_ACTION_TYPES as readonly unknown[]).includes(t)
}

/** what the action pickers need from the draft: pages with their blocks (local preview) */
export interface MssgActionContext {
  pages: Pick<MssgPageProjection, 'id' | 'name' | 'blocks'>[]
}

/** blocks of a page an anchor can point to (real or temp ids; blocks of a page cloned in the draft have no id yet) */
export function mssgAnchorBlocks(ctx: MssgActionContext, pageId: string): { id: string, kind: string, label: string }[] {
  const page = ctx.pages.find(p => p.id === pageId)
  return (page?.blocks ?? []).filter(b => ID_RE.test(b.id)).map(b => ({ id: b.id, kind: b.kind, label: b.kind }))
}

/** a new action of `type` with the first sensible target */
export function mssgDefaultAction(type: string, ctx: MssgActionContext): Record<string, unknown> {
  const firstPage = ctx.pages.find(p => ID_RE.test(p.id))?.id ?? ''
  switch (type) {
    case 'url':
    case 'tel':
    case 'email':
    case 'sms':
      return { type, url: '' }
    case 'page':
      return { type, page: firstPage }
    case 'anchor': {
      const withBlocks = ctx.pages.find(p => ID_RE.test(p.id) && mssgAnchorBlocks(ctx, p.id).length)?.id ?? firstPage
      return { type, anchor: { page: withBlocks, block: mssgAnchorBlocks(ctx, withBlocks)[0]?.id ?? '' } }
    }
    default:
      return { type }
  }
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export interface MssgActionIssue {
  /** relative to the action: `type`, `url`, `page`, `anchor.page`, `anchor.block` */
  path: string
  message: string
}

/**
 * Apollo's rules of contract §3.4 for one action (`image` = Image / gallery: `nothing` and `fullImage` allowed).
 * An unknown type read from mssg is valid (kept as read); `null` / a missing type is not. Without `ctx` the page / block
 * targets are only checked for presence (static schema).
 */
export function mssgActionIssues(action: unknown, ctx: MssgActionContext | null, image: boolean): MssgActionIssue[] {
  const a = (action && typeof action === 'object' ? action : {}) as Record<string, unknown>
  const type = a.type
  if (typeof type !== 'string' || !type) return [{ path: 'type', message: 'เลือกว่ากดแล้วทำอะไร' }]
  if (!image && (type === 'nothing' || type === 'fullImage')) return [{ path: 'type', message: 'ปุ่มลิงก์ต้องเลือกว่ากดแล้วทำอะไร' }]
  const url = typeof a.url === 'string' ? a.url.trim() : ''
  switch (type) {
    case 'url':
      if (!url) return [{ path: 'url', message: 'กรอกปลายทาง' }]
      if (url.length > 2000) return [{ path: 'url', message: 'ลิงก์ยาวได้ไม่เกิน 2,000 ตัวอักษร' }]
      return isHttpUrl(url) ? [] : [{ path: 'url', message: 'ปลายทางต้องเป็นลิงก์ที่ขึ้นต้นด้วย http:// หรือ https://' }]
    case 'tel':
    case 'sms':
      if (!url) return [{ path: 'url', message: 'กรอกเบอร์โทร' }]
      return MSSG_PHONE_RE.test(url) ? [] : [{ path: 'url', message: 'เบอร์โทรใช้ได้เฉพาะตัวเลข เว้นวรรค ( ) - และ + ข้างหน้า (3–30 ตัว) · ไม่ต้องใส่ tel:' }]
    case 'email':
      if (!url) return [{ path: 'url', message: 'กรอกอีเมล' }]
      if (url.length > 254 || /^mailto:/i.test(url) || !EMAIL_RE.test(url)) return [{ path: 'url', message: 'อีเมลไม่ถูกต้อง · ใส่เป็น name@example.com (ไม่ต้องใส่ mailto:)' }]
      return []
    case 'page': {
      const page = typeof a.page === 'string' ? a.page : ''
      if (!page) return [{ path: 'page', message: 'เลือกหน้าปลายทาง' }]
      return !ctx || ctx.pages.some(p => p.id === page) ? [] : [{ path: 'page', message: 'หน้านี้ไม่มีในเว็บแล้ว · เลือกหน้าใหม่' }]
    }
    case 'anchor': {
      const an = (a.anchor && typeof a.anchor === 'object' ? a.anchor : {}) as Record<string, unknown>
      const page = typeof an.page === 'string' ? an.page : ''
      const block = typeof an.block === 'string' ? an.block : ''
      if (!page) return [{ path: 'anchor.page', message: 'เลือกหน้าของ block ปลายทาง' }]
      if (ctx && !ctx.pages.some(p => p.id === page)) return [{ path: 'anchor.page', message: 'หน้านี้ไม่มีในเว็บแล้ว · เลือกหน้าใหม่' }]
      if (!block) return [{ path: 'anchor.block', message: 'เลือก block ปลายทาง' }]
      return !ctx || mssgAnchorBlocks(ctx, page).some(b => b.id === block) ? [] : [{ path: 'anchor.block', message: 'block นี้ไม่อยู่ในหน้าที่เลือกแล้ว · เลือกใหม่' }]
    }
    default:
      // nothing / fullImage (image only, checked above) and types read from mssg that Apollo does not know: as read
      return []
  }
}

/** the action as sent: the contract shape for the known types (trimmed value), as read for the others */
export function mssgActionOut(action: unknown): unknown {
  if (!action || typeof action !== 'object') return action
  const a = action as Record<string, unknown>
  const type = a.type
  const url = typeof a.url === 'string' ? a.url.trim() : ''
  switch (type) {
    case 'url':
    case 'tel':
    case 'email':
    case 'sms':
      return { ...a, url }
    default:
      return JSON.parse(JSON.stringify(a))
  }
}

/** a short text of an action for the block list / preview */
export function mssgActionText(action: unknown, site: Pick<MssgSiteProjection, 'pages'> | null | undefined): string {
  const a = (action && typeof action === 'object' ? action : {}) as Record<string, unknown>
  const url = typeof a.url === 'string' ? a.url : ''
  switch (a.type) {
    case 'url':
      try {
        return new URL(url).hostname.replace(/^www\./, '')
      } catch {
        return ''
      }
    case 'page':
      return `→ ${site?.pages.find(p => p.id === a.page)?.name ?? 'หน้าภายใน'}`
    case 'tel':
      return url ? `โทร ${url}` : 'โทร'
    case 'sms':
      return url ? `SMS ${url}` : 'SMS'
    case 'email':
      return url ? `อีเมล ${url}` : 'อีเมล'
    case 'anchor': {
      const an = (a.anchor ?? {}) as Record<string, unknown>
      const name = site?.pages.find(p => p.id === an.page)?.name
      return `↓ block${name ? ` ในหน้า ${name}` : ''}`
    }
    case 'fullImage':
      return 'เปิดรูปเต็ม'
    default:
      return ''
  }
}

// ── Messengers (contract §3.4 pairs) ────────────────────────────────────────────────────────────────────────────────
export const MSSG_MESSENGER_TYPES: Record<string, string[]> = {
  telegram: ['auto', 'private', 'secret'],
  viber: ['auto', 'public', 'community', 'private'],
  whatsapp: ['auto', 'private', 'public'],
  messenger: ['auto', 'private'],
  instagram: ['auto']
}
export const MSSG_MESSENGER_PLATFORMS = Object.keys(MSSG_MESSENGER_TYPES)

export const MSSG_MESSENGER_PLATFORM_LABEL: Record<string, string> = {
  telegram: 'Telegram',
  viber: 'Viber',
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram'
}
export const MSSG_MESSENGER_TYPE_LABEL: Record<string, string> = {
  auto: 'อัตโนมัติ (Auto)',
  private: 'ส่วนตัว (Private)',
  secret: 'แชทลับ (Secret)',
  public: 'สาธารณะ (Public)',
  community: 'ชุมชน (Community)'
}

/** a platform Apollo can edit; any other platform read from mssg is shown read-only and sent back as read */
export function mssgMessengerEditable(platform: unknown): boolean {
  return typeof platform === 'string' && platform in MSSG_MESSENGER_TYPES
}

/** the type to keep when the platform changes: the same type when the new platform allows it, else `auto` */
export function mssgMessengerTypeFor(platform: string, type: unknown): string {
  const allowed = MSSG_MESSENGER_TYPES[platform] ?? []
  return typeof type === 'string' && allowed.includes(type) ? type : 'auto'
}

/** contract §3.4: an editable platform needs one of its types (unknown platforms are not checked — kept as read) */
export function mssgMessengerIssue(row: { platform?: unknown, type?: unknown }): { path: 'platform' | 'type', message: string } | null {
  if (!row.platform) return { path: 'platform', message: 'เลือกแอปแชท' }
  if (!mssgMessengerEditable(row.platform)) return null
  const allowed = MSSG_MESSENGER_TYPES[row.platform as string]!
  return typeof row.type === 'string' && allowed.includes(row.type) ? null : { path: 'type', message: `แบบของปุ่ม ${MSSG_MESSENGER_PLATFORM_LABEL[row.platform as string]} เลือกได้: ${allowed.join(', ')}` }
}
