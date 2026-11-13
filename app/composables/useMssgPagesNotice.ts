/**
 * FEAT-101 B5 (AC-37) — a one-shot notice the site editor leaves for `/mssg-pages` (e.g. "ลบเว็บแล้ว" after a delete,
 * which ends with the site gone and the editor navigating back). Client navigation only: the list page reads it once
 * on setup and clears it, so it never shows twice. A toast is shown as well, so a reload in between loses nothing.
 */
export interface MssgPagesNotice {
  kind: 'deleted'
  title: string
  description?: string
  color: 'success' | 'info' | 'warning'
}

export function useMssgPagesNotice() {
  return useState<MssgPagesNotice | null>('mssg-pages-notice', () => null)
}
