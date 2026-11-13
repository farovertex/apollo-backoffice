/**
 * FEAT-101 reopen (B2r; api-contract.md v1.6 §3.4 "Menu", AC-48) — the "เมนู" section of step 2. Pure helpers (explicit
 * imports) for `tests/unit/mssg-reopen.test.ts`.
 *
 * - Rows = the pages of the preview that exist on mssg (real ids), in the order of `menu.items`; a page without a menu item
 *   follows in page order with its name as label and hidden. Pages created in the draft (temp ids) get no row — mssg
 *   creates them, they are editable after the next save (note).
 * - Every edit is sent as one folded `site.update { menu: { enabled?, items? } }`; `items` is always the **whole ordered
 *   list** of the rows (`{ page, label, enabled }`, label trimmed).
 */
import * as z from 'zod'
import type { MssgSiteMenuItem, MssgSiteProjection } from '../../shared/types/mssg-sites'

const TEMP_RE = /^tmp-[a-z0-9]{4,32}$/

export interface MssgMenuRow extends MssgSiteMenuItem {
  /** the page's name (row title) */
  name: string
}

export const mssgMenuLabelSchema = z.string().trim()
  .min(1, 'กรอกชื่อในเมนู')
  .max(100, 'ชื่อในเมนูยาวได้ไม่เกิน 100 ตัวอักษร')

/** the rows of the menu editor (see the file header) */
export function mssgMenuRows(site: Pick<MssgSiteProjection, 'pages' | 'menu'> | null | undefined): MssgMenuRow[] {
  const pages = (site?.pages ?? []).filter(p => !TEMP_RE.test(p.id))
  const byId = new Map(pages.map(p => [p.id, p]))
  const rows: MssgMenuRow[] = []
  const seen = new Set<string>()
  for (const it of site?.menu?.items ?? []) {
    const page = byId.get(it.page)
    if (!page || seen.has(it.page)) continue
    seen.add(it.page)
    rows.push({ page: it.page, label: typeof it.label === 'string' ? it.label : page.name, enabled: it.enabled !== false, name: page.name })
  }
  for (const p of pages) {
    if (!seen.has(p.id)) rows.push({ page: p.id, label: p.name, enabled: false, name: p.name })
  }
  return rows
}

/** pages created in the draft — shown in the note instead of a row */
export function mssgMenuNewPages(site: Pick<MssgSiteProjection, 'pages'> | null | undefined): { id: string, name: string }[] {
  return (site?.pages ?? []).filter(p => TEMP_RE.test(p.id)).map(p => ({ id: p.id, name: p.name }))
}

/** `menu.items` as sent: the whole ordered list */
export function mssgMenuItems(rows: MssgMenuRow[]): MssgSiteMenuItem[] {
  return rows.map(r => ({ page: r.page, label: r.label.trim(), enabled: r.enabled }))
}

/** rows with one page moved up (`-1`) or down (`+1`); unchanged at the ends */
export function mssgMenuMove(rows: MssgMenuRow[], page: string, dir: -1 | 1): MssgMenuRow[] {
  const i = rows.findIndex(r => r.page === page)
  const j = i + dir
  if (i < 0 || j < 0 || j >= rows.length) return rows
  const next = rows.slice()
  const [row] = next.splice(i, 1)
  next.splice(j, 0, row!)
  return next
}

/** rows with one row's label / shown state changed */
export function mssgMenuSet(rows: MssgMenuRow[], page: string, patch: Partial<Pick<MssgMenuRow, 'label' | 'enabled'>>): MssgMenuRow[] {
  return rows.map(r => (r.page === page ? { ...r, ...patch } : r))
}
