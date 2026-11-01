/**
 * FEAT-095 — admin notifications (api-contract v1 §5/§6). Types shared by the Nitro side (server/) and the app.
 * Views come from the API's `toNotificationView()`: ids are strings, timestamps ISO, `null` where unknown.
 */

/** the 9 event kinds (contract §1.1 / Definitions) */
export type NotificationKind
  = 'login'
    | 'build'
    | 'topupReady'
    | 'topupOtp'
    | 'topupDone'
    | 'guardClose'
    | 'advBanned'
    | 'adApproved'
    | 'adRejected'

/** severity → colour + icon in the BO */
export type NotificationLevel = 'success' | 'error' | 'warning' | 'info'

/** who triggered the event (`null` for system events: auto top-up, kpi, guard) */
export interface NotificationActor {
  adminId: string
  displayName: string
}

/** the page the BO navigates to when a row / toast is opened (always present) */
export interface NotificationLink {
  path: string
  query: Record<string, string>
}

/** cross-references (ids as strings in the view, absent when not applicable) */
export interface NotificationRef {
  workspaceId?: string | null
  tiktokAccountId?: string
  advertiserId?: string
  jobId?: string
  buildId?: string
  orderId?: string
  topupId?: string
  humanTaskId?: string
  /** up to 50 ad ids (adApproved / adRejected) */
  adIds?: string[]
  /** only on failures */
  errorCode?: string
  trigger?: 'manual' | 'auto'
}

/** one notification row as the API exposes it (contract §5) */
export interface NotificationView {
  id: string
  kind: NotificationKind
  level: NotificationLevel
  title: string
  body: string | null
  actor: NotificationActor | null
  link: NotificationLink
  ref: NotificationRef
  readAt: string | null
  createdAt: string
}

/** GET /notifications → 200 (contract §2) */
export interface NotificationListResponse {
  notifications: NotificationView[]
  /** opaque `"<createdAt ISO>_<id>"`; `null` on the last page */
  nextCursor: string | null
  /** the caller's total unread, independent of the `unread` filter */
  unreadCount: number
}

/** GET /notifications/unread-count → 200 */
export interface NotificationUnreadCountResponse {
  unreadCount: number
}

/** POST /notifications/:id/read → 200 */
export interface NotificationReadResponse {
  id: string
  readAt: string
}

/** POST /notifications/read-all → 200 */
export interface NotificationReadAllResponse {
  updated: number
  readAt: string
}
