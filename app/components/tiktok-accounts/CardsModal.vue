<script setup lang="ts">
/**
 * FEAT-078 (spec "UI behaviour", api-contract §2.1–§2.7 + §6) — **จัดการบัตร** of one TikTok account.
 * Rebuilt from the FEAT-051 "บัตรที่จำไว้" modal (AC-35); same dialog testid `ta-cards-modal`.
 *
 * Two sections fed by **one** `GET /tiktok-accounts/:id/payment-cards` (`{ cards, tiktok, job }`):
 *   1. **บัตรที่ TikTok จำไว้** (`tiktok.cards`) — what TikTok has on file for the account's Business Center, as the
 *      last `topup/cardManage` job read it from the BC payment page. Three actions, each one job:
 *        `POST …/payment-cards/sync`                                  (no body)
 *        `POST …/payment-cards/tiktok/:tiktokCardId/primary`          `{ dryRun: false }` — after a confirm dialog
 *        `POST …/payment-cards/tiktok/:tiktokCardId/remove`           `{ dryRun: false }` — after a confirm dialog
 *      202 (new) and 200 (`reused: true`) are the same to this modal: show the job chip and follow the job.
 *      409 `{ error, jobId }` = another job is open → warning toast + follow that job; 404/409 without `jobId`
 *      (gates) → warning toast only.
 *   2. **บัตรที่เราเก็บไว้** (`cards`) — our FEAT-051 card channel. The DB-only buttons (`POST …/:cardId/default`,
 *      `DELETE …/:cardId`) only exist for cards TikTok has never seen (`tiktokCardId === null && status !==
 *      'bound'`, B8): every TikTok-known card goes through the job, which mirrors the change into our data.
 *
 * Polling: while `job.status ∈ waiting | active` the same `GET` is re-issued every 2 s by this modal's own loop
 * (the `TtLinkModal` pattern): never two requests in flight, the first tick 2 s after the action (the chip shows
 * the POST's `waiting` until then), stopped on close / unmount / a terminal job. Every poll replaces both lists, so
 * the result of a job is on screen the moment it ends. A failed poll keeps the last state, shows `ta-cards-error`
 * inline and the next tick tries again.
 *
 * Roles: GOD or Admin of the account's workspace (the page only offers `ta-cards-open` to them); a stale Payment-only
 * session sees the API's 403 text in `ta-cards-error`. 503 (no `CARD_ENCRYPTION_KEY`) blocks the `GET` and so the
 * whole modal, as before.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  CardManageAction,
  CardManageConflictBody,
  CardManageJobView,
  CardManageRequestBody,
  CardManageRequestResponse,
  PaymentCardStatus,
  PaymentCardView,
  PaymentCardsResponse,
  TikTokCardView,
  TikTokCardsBlock
} from '#shared/types/payment-cards'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  /** null while the modal is closed */
  account: TikTokAccount | null
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()

const POLL_MS = 2000
const BANNER = 'มีผลกับทุกบัญชีที่ใช้พอร์ตโฟลิโอการเงินเดียวกัน'
const NO_BC_TITLE = 'กด Sync บัญชีก่อน'
const JOB_OPEN_TITLE = 'รอให้ job จัดการบัตรที่ค้างอยู่จบก่อน'

const modalContent = { 'data-testid': 'ta-cards-modal' } as ModalProps['content']

const CARD_STATUS: Record<PaymentCardStatus, { label: string, color: 'neutral' | 'success' | 'warning' | 'error' }> = {
  pending: { label: 'ยังไม่เคยจ่าย', color: 'neutral' },
  bound: { label: 'ใช้งานได้', color: 'success' },
  expired: { label: 'หมดอายุ', color: 'warning' },
  removed: { label: 'ถูกลบ', color: 'error' }
}

const EMPTY_TIKTOK: TikTokCardsBlock = { syncedAt: null, error: null, cards: [] }

const cards = ref<PaymentCardView[]>([])
const tiktok = ref<TikTokCardsBlock>(EMPTY_TIKTOK)
const job = ref<CardManageJobView | null>(null)
const pending = ref(false)
const loaded = ref(false)
/** the open's `GET` failed → the whole modal is this alert */
const errorText = ref<string | null>(null)
/** a poll failed → inline alert above the sections, cleared by the next good poll */
const pollError = ref<string | null>(null)
/** cardId with a DB-only request in flight (one spinner per row, no double click) */
const busyId = ref<string | null>(null)
/** a job POST is in flight (`sync` / `<tiktokCardId>`) */
const requesting = ref<string | null>(null)
/** jobs this open created or saw open — only their terminal state is announced (toast / failed chip) */
const followed = ref(new Set<string>())
const announced = new Set<string>()
let session = 0

const accountName = computed(() => props.account?.bcOrgName || props.account?.label || props.account?.loginEmail || '')
const hasBc = computed(() => !!props.account?.bcOrgId)

function isOpenStatus(status: string | null | undefined): boolean {
  return status === 'waiting' || status === 'active'
}
const jobOpen = computed(() => isOpenStatus(job.value?.status))
/** every TikTok action + Sync is disabled while a job is open, without a BC org and while a POST is in flight */
const ttLocked = computed(() => jobOpen.value || !hasBc.value || !!requesting.value)
const lockTitle = computed<string | undefined>(() => {
  if (!hasBc.value) return NO_BC_TITLE
  if (jobOpen.value) return JOB_OPEN_TITLE
  return undefined
})

/** waiting/active always; failed/cancelled only for a job this open followed (stays until the next action) */
const showChip = computed(() => {
  const j = job.value
  if (!j) return false
  if (isOpenStatus(j.status)) return true
  return j.status !== 'completed' && followed.value.has(j.id)
})

const ourById = computed(() => new Map(cards.value.map(c => [c.cardId, c])))
const ttById = computed(() => new Map(tiktok.value.cards.map(c => [c.id, c])))

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────
let inFlight = false

function apply(res: PaymentCardsResponse) {
  cards.value = (res.cards ?? []).map(c => ({ ...c, tiktokCardId: c.tiktokCardId ?? null }))
  tiktok.value = res.tiktok ?? EMPTY_TIKTOK
  const next = res.job ?? null
  job.value = next
  if (!next) return
  if (isOpenStatus(next.status)) {
    follow(next.id)
    return
  }
  if (!followed.value.has(next.id) || announced.has(next.id)) return
  announced.add(next.id)
  if (next.status === 'completed') {
    toast.add({
      'title': completedText(next),
      'color': 'success',
      'data-testid': 'ta-toast'
    } as Parameters<typeof toast.add>[0])
  }
}

function follow(jobId: string) {
  if (followed.value.has(jobId)) return
  followed.value = new Set([...followed.value, jobId])
}

function errText(e: unknown, fallback: string): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  return err.data?.error ?? err.message ?? fallback
}

/** the one `GET` — the open's read, a poll tick, or the re-read after a DB-only mutation */
async function read(kind: 'open' | 'poll' | 'refresh') {
  const id = props.account?.id
  if (!id || inFlight) return
  const s = session
  inFlight = true
  if (kind === 'open') pending.value = true
  try {
    // retry: 0 — one request per open / per tick; ofetch must not re-issue it on 5xx
    const res = await api<PaymentCardsResponse>(`/tiktok-accounts/${encodeURIComponent(id)}/payment-cards`, { retry: 0 })
    if (s !== session) return
    apply(res)
    loaded.value = true
    errorText.value = null
    pollError.value = null
  } catch (e) {
    if (s !== session) return
    const text = errText(e, 'อ่านรายการบัตรไม่สำเร็จ')
    if (loaded.value) {
      // keep the last lists + chip; the loop keeps running and the next good tick clears this
      pollError.value = text
    } else {
      cards.value = []
      tiktok.value = EMPTY_TIKTOK
      job.value = null
      errorText.value = text
    }
  } finally {
    if (s === session) {
      inFlight = false
      pending.value = false
    }
  }
}

// ── the 2 s loop ─────────────────────────────────────────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null

function stopPoll() {
  if (timer) clearInterval(timer)
  timer = null
}

const shouldPoll = computed(() => open.value && loaded.value && jobOpen.value)

watch(shouldPoll, (on) => {
  if (!on) {
    stopPoll()
    return
  }
  if (timer) return
  timer = setInterval(() => {
    void read('poll')
  }, POLL_MS)
})

watch(open, (isOpen) => {
  session++
  inFlight = false
  stopPoll()
  if (isOpen) {
    cards.value = []
    tiktok.value = EMPTY_TIKTOK
    job.value = null
    loaded.value = false
    errorText.value = null
    pollError.value = null
    busyId.value = null
    requesting.value = null
    followed.value = new Set()
    announced.clear()
    confirmOpen.value = false
    void read('open')
  }
})

onUnmounted(() => {
  session++
  stopPoll()
})

// ── texts ────────────────────────────────────────────────────────────────────────────────────────────────────────
function ttBrand(card: { brand: string | null, brandCode?: string | null }): string {
  return card.brand || card.brandCode || 'บัตร'
}

function jobRunningText(j: CardManageJobView): string {
  if (j.action === 'setPrimary') return `กำลังตั้งบัตรหลัก ${cardMask(j.last4)}…`
  if (j.action === 'remove') return `กำลังลบ ${cardMask(j.last4)}…`
  return 'กำลังซิงค์…'
}

function jobFailedText(j: CardManageJobView): string {
  const verb = j.status === 'cancelled' ? 'ถูกยกเลิก' : 'ไม่สำเร็จ'
  if (j.action === 'setPrimary') return `ตั้งบัตรหลัก ${cardMask(j.last4)} ${verb}`
  if (j.action === 'remove') return `ลบ ${cardMask(j.last4)} ${verb}`
  return `ซิงค์${verb}`
}

function jobErrorDetail(j: CardManageJobView): string {
  const parts = [j.error, j.lastLog].filter((p): p is string => !!p)
  return parts.length ? parts.join(' — ') : (j.status === 'cancelled' ? 'job ถูกยกเลิก' : 'job ไม่สำเร็จ')
}

function completedText(j: CardManageJobView): string {
  const last4 = j.last4 ?? j.result?.affectedLast4 ?? null
  if (j.action === 'setPrimary') return `ตั้ง ${cardMask(last4)} เป็นบัตรหลักแล้ว`
  if (j.action === 'remove') return `ลบ ${cardMask(last4)} แล้ว`
  return `ซิงค์แล้ว · ${j.result?.cards ?? tiktok.value.cards.length} ใบ`
}

function ttLinkText(card: TikTokCardView): string {
  if (!card.ourCardId) return 'เรายังไม่มีใบนี้'
  const ours = ourById.value.get(card.ourCardId)
  const text = `บัตรของเรา ${cardMask(ours?.last4 ?? card.last4)}`
  return ours?.isDefault ? `${text} · ค่าเริ่มต้น` : text
}

function ourLinkText(card: PaymentCardView): string | null {
  if (card.tiktokCardId) return `ผูกกับ TikTok ${cardMask(ttById.value.get(card.tiktokCardId)?.last4 ?? card.last4)}`
  if (card.status === 'pending') return 'TikTok ยังไม่เห็นใบนี้'
  if (card.status === 'bound' && tiktok.value.syncedAt) return 'TikTok ไม่มีใบนี้แล้ว'
  return null
}

/** B8 — the DB-only buttons only for a card TikTok has never seen */
function dbOnly(card: PaymentCardView): boolean {
  return !card.tiktokCardId && card.status !== 'bound'
}

function primaryReason(card: TikTokCardView): string | undefined {
  if (card.expired || !card.valid) return 'บัตรหมดอายุ'
  return lockTitle.value
}

function removeReason(card: TikTokCardView): string | undefined {
  if (card.primary) return 'ตั้งใบอื่นเป็นหลักก่อน'
  if (tiktok.value.cards.length <= 1) return 'ใบสุดท้ายลบไม่ได้'
  if (card.allowRemove === false) return 'TikTok ไม่อนุญาตให้ลบใบนี้'
  return lockTitle.value
}

function removeBlocked(card: TikTokCardView): boolean {
  return card.primary || tiktok.value.cards.length <= 1 || card.allowRemove === false
}

// ── TikTok actions ───────────────────────────────────────────────────────────────────────────────────────────────
const confirmOpen = ref(false)
const confirmCard = ref<TikTokCardView | null>(null)
const confirmAction = ref<'setPrimary' | 'remove'>('setPrimary')
const confirmContent = computed(() => ({
  'data-testid': 'ta-cards-confirm',
  'data-action': confirmAction.value
}) as ModalProps['content'])
const confirmTitle = computed(() => confirmAction.value === 'remove' ? 'ลบบัตร' : 'ตั้งเป็นบัตรหลัก')
const confirmText = computed(() => {
  const card = confirmCard.value
  if (!card) return ''
  const name = `${ttBrand(card)} ${cardMask(card.last4)}`
  return confirmAction.value === 'remove'
    ? `ลบ ${name} ออกจาก TikTok และจากรายการของเรา? ย้อนกลับไม่ได้`
    : `ตั้ง ${name} เป็นบัตรหลักที่ TikTok และเป็นค่าเริ่มต้นของเรา?`
})

function askConfirm(card: TikTokCardView, action: 'setPrimary' | 'remove') {
  if (ttLocked.value) return
  confirmCard.value = card
  confirmAction.value = action
  confirmOpen.value = true
}

const FAIL_TITLE: Record<CardManageAction, string> = {
  sync: 'ซิงค์ไม่ได้',
  setPrimary: 'ตั้งบัตรหลักไม่ได้',
  remove: 'ลบบัตรไม่ได้'
}

/** one job POST; the chip + the loop take over on 202/200 */
async function requestJob(action: CardManageAction, card: TikTokCardView | null) {
  const id = props.account?.id
  if (!id || ttLocked.value) return
  const base = `/tiktok-accounts/${encodeURIComponent(id)}/payment-cards`
  const url = card
    ? `${base}/tiktok/${encodeURIComponent(card.id)}/${action === 'remove' ? 'remove' : 'primary'}`
    : `${base}/sync`
  const s = session
  requesting.value = card?.id ?? 'sync'
  try {
    // retry: 0 — exactly one POST per click (a retried POST could queue a second job)
    const res = await api<CardManageRequestResponse>(url, card
      ? { method: 'POST', retry: 0, body: { dryRun: false } satisfies CardManageRequestBody }
      : { method: 'POST', retry: 0 })
    if (s !== session) return
    confirmOpen.value = false
    follow(res.jobId)
    // the chip shows the request until the first poll's `job` (2 s later) replaces it
    job.value = {
      id: res.jobId,
      status: 'waiting',
      step: null,
      error: null,
      action: res.action ?? action,
      tiktokCardId: res.tiktokCardId ?? card?.id ?? null,
      last4: res.last4 ?? card?.last4 ?? null,
      dryRun: false,
      result: null,
      lastLog: null,
      createdAt: new Date().toISOString(),
      finishedAt: null
    }
  } catch (e) {
    if (s !== session) return
    confirmOpen.value = false
    const err = e as FetchError<Partial<CardManageConflictBody>>
    const status = err.response?.status ?? err.statusCode
    toast.add({
      'title': FAIL_TITLE[action],
      'description': err.data?.error ?? err.message ?? 'ทำรายการไม่สำเร็จ',
      'color': status === 409 || status === 404 || status === 403 ? 'warning' : 'error',
      'data-testid': 'ta-toast'
    } as Parameters<typeof toast.add>[0])
    // 409 with `jobId`: another cardManage job is open → read once, its `job` becomes the chip and the loop starts
    const openJobId = err.data?.jobId
    if (status === 409 && openJobId) {
      follow(openJobId)
      requesting.value = null
      await read('refresh')
    }
  } finally {
    if (s === session) requesting.value = null
  }
}

function onConfirm() {
  const card = confirmCard.value
  if (!card) return
  void requestJob(confirmAction.value, card)
}

// ── our cards (DB-only, FEAT-051) ────────────────────────────────────────────────────────────────────────────────
function fail(title: string, e: unknown) {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const status = err.response?.status ?? err.statusCode
  toast.add({
    'title': title,
    'description': err.data?.error ?? err.message ?? 'ทำรายการไม่สำเร็จ',
    'color': status === 409 || status === 403 ? 'warning' : 'error',
    'data-testid': 'ta-toast'
  } as Parameters<typeof toast.add>[0])
}

async function setDefault(card: PaymentCardView) {
  const id = props.account?.id
  if (!id || busyId.value) return
  busyId.value = card.cardId
  try {
    // 200 = the whole §2.1 body
    const res = await api<PaymentCardsResponse>(
      `/tiktok-accounts/${encodeURIComponent(id)}/payment-cards/${encodeURIComponent(card.cardId)}/default`,
      { method: 'POST', retry: 0 }
    )
    apply({ cards: res.cards ?? cards.value, tiktok: res.tiktok ?? tiktok.value, job: res.job === undefined ? job.value : res.job })
  } catch (e) {
    fail('ตั้งเป็นบัตรเริ่มต้นไม่สำเร็จ', e)
  } finally {
    busyId.value = null
  }
}

async function remove(card: PaymentCardView) {
  const id = props.account?.id
  if (!id || busyId.value) return
  busyId.value = card.cardId
  try {
    await api(
      `/tiktok-accounts/${encodeURIComponent(id)}/payment-cards/${encodeURIComponent(card.cardId)}`,
      { method: 'DELETE', retry: 0 }
    )
    toast.add({
      'title': 'ลบบัตรแล้ว',
      'description': cardSummary(card),
      'color': 'success',
      'data-testid': 'ta-toast'
    } as Parameters<typeof toast.add>[0])
    await read('refresh')
  } catch (e) {
    // 409 "บัตรใบนี้กำลังถูกใช้ในรอบที่ยังไม่จบ" / "บัตรใบนี้ TikTok รู้จักแล้ว…" — the API's own text
    fail('ลบบัตรไม่สำเร็จ', e)
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="จัดการบัตร"
    :description="accountName || undefined"
    :ui="{ content: 'max-w-2xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex min-w-0 flex-col gap-4">
        <USkeleton v-if="pending && !loaded" class="h-16 w-full" data-testid="ta-cards-loading" />

        <UAlert
          v-else-if="errorText"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="อ่านรายการบัตรไม่สำเร็จ"
          :description="errorText"
          data-testid="ta-cards-error"
        />

        <template v-else-if="loaded">
          <UAlert
            v-if="pollError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="อ่านรายการบัตรไม่สำเร็จ"
            :description="pollError"
            data-testid="ta-cards-error"
          />

          <!-- 1. the cards TikTok has on file -->
          <section class="flex min-w-0 flex-col gap-2" data-testid="ta-tt-cards">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div class="flex min-w-0 flex-col gap-0.5">
                <h3 class="text-sm font-semibold text-highlighted">
                  บัตรที่ TikTok จำไว้
                </h3>
                <span class="text-xs text-muted" data-testid="ta-tt-cards-synced">
                  {{ tiktok.syncedAt ? `ซิงค์ล่าสุด ${formatDateTime(tiktok.syncedAt)}` : 'ยังไม่เคยซิงค์' }}
                </span>
                <span v-if="tiktok.error" class="break-words text-xs text-error" data-testid="ta-tt-cards-error">
                  {{ tiktok.error }}
                </span>
              </div>
              <UButton
                label="Sync"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                size="xs"
                :loading="requesting === 'sync'"
                :disabled="ttLocked"
                :title="lockTitle"
                data-testid="ta-cards-sync"
                @click="requestJob('sync', null)"
              />
            </div>

            <!-- the job chip: running / failed (completed → toast, chip gone) -->
            <div
              v-if="showChip && job"
              class="flex min-w-0 flex-col gap-1.5 rounded-lg border border-default bg-elevated/50 px-3 py-2"
              data-testid="ta-cards-job"
              :data-status="job.status"
              :data-action="job.action"
            >
              <template v-if="jobOpen">
                <span class="flex min-w-0 items-center gap-2 text-sm text-highlighted">
                  <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-primary" />
                  <span class="break-words">{{ jobRunningText(job) }}</span>
                </span>
                <span v-if="job.lastLog" class="break-words text-xs text-muted" data-testid="ta-cards-job-log">
                  {{ job.lastLog }}
                </span>
              </template>
              <UAlert
                v-else
                color="error"
                variant="subtle"
                icon="i-lucide-circle-x"
                :title="jobFailedText(job)"
                :description="jobErrorDetail(job)"
                data-testid="ta-cards-job-error"
              />
            </div>

            <UAlert
              v-if="!tiktok.syncedAt || tiktok.cards.length === 0"
              color="neutral"
              variant="subtle"
              icon="i-lucide-credit-card"
              :title="tiktok.syncedAt ? 'TikTok ไม่มีบัตรที่จำไว้' : 'ยังไม่เคยซิงค์ — กด Sync เพื่ออ่านรายการบัตรจาก TikTok'"
              data-testid="ta-tt-cards-empty"
            />

            <div
              v-for="card in tiktok.cards"
              :key="card.id"
              class="flex flex-col gap-2 rounded-lg border border-default px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              data-testid="ta-tt-card-row"
              :data-tiktok-card-id="card.id"
              :data-last4="card.last4"
              :data-primary="card.primary ? 'true' : 'false'"
              :data-linked="card.ourCardId ?? ''"
            >
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                  <UIcon name="i-lucide-credit-card" class="size-4 shrink-0 text-muted" />
                  <span class="break-words" data-testid="ta-tt-card-line">{{ ttBrand(card) }} **** {{ card.last4 }}</span>
                  <UBadge
                    v-if="card.primary"
                    label="บัตรหลัก"
                    color="primary"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                    data-testid="ta-tt-card-primary-badge"
                  />
                  <UBadge
                    v-if="card.expired"
                    label="หมดอายุ"
                    color="warning"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                    data-testid="ta-tt-card-expired"
                  />
                  <UBadge
                    v-else-if="!card.valid"
                    label="ใช้ไม่ได้"
                    color="error"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                    data-testid="ta-tt-card-invalid"
                  />
                </span>
                <span class="flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
                  <span v-if="card.expiry">หมดอายุ {{ card.expiry }}</span>
                  <span v-if="card.expiry" aria-hidden="true">·</span>
                  <span class="break-words" data-testid="ta-tt-card-link">{{ ttLinkText(card) }}</span>
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-1">
                <UButton
                  v-if="!card.primary"
                  label="ตั้งเป็นบัตรหลัก"
                  icon="i-lucide-pin"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  :loading="requesting === card.id && confirmAction === 'setPrimary'"
                  :disabled="ttLocked || card.expired || !card.valid"
                  :title="primaryReason(card)"
                  data-testid="ta-tt-card-primary"
                  @click="askConfirm(card, 'setPrimary')"
                />
                <UButton
                  label="ลบ"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="outline"
                  size="xs"
                  :loading="requesting === card.id && confirmAction === 'remove'"
                  :disabled="ttLocked || removeBlocked(card)"
                  :title="removeReason(card)"
                  data-testid="ta-tt-card-remove"
                  @click="askConfirm(card, 'remove')"
                />
              </div>
            </div>
          </section>

          <USeparator />

          <!-- 2. the cards we store (FEAT-051 card channel) -->
          <section class="flex min-w-0 flex-col gap-2" data-testid="ta-our-cards">
            <h3 class="text-sm font-semibold text-highlighted">
              บัตรที่เราเก็บไว้
            </h3>

            <UAlert
              v-if="cards.length === 0"
              color="neutral"
              variant="subtle"
              icon="i-lucide-credit-card"
              title="ยังไม่มีบัตรที่จำไว้"
              description="กรอกบัตรตอนจ่ายครั้งแรกของบัญชีนี้ แล้วระบบจะจำไว้ให้เอง"
              data-testid="ta-cards-empty"
            />

            <div
              v-for="card in cards"
              :key="card.cardId"
              class="flex flex-col gap-2 rounded-lg border border-default px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              data-testid="ta-card-row"
              :data-card-id="card.cardId"
              :data-status="card.status"
              :data-default="card.isDefault ? 'true' : 'false'"
              :data-tiktok-card-id="card.tiktokCardId ?? ''"
            >
              <div class="flex min-w-0 flex-col gap-0.5">
                <span class="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                  <UIcon name="i-lucide-credit-card" class="size-4 shrink-0 text-muted" />
                  <span class="break-words" data-testid="ta-card-line">{{ cardSummary(card) }}</span>
                  <UBadge
                    v-if="card.isDefault"
                    label="ค่าเริ่มต้น"
                    color="primary"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                    data-testid="ta-card-default-badge"
                  />
                </span>
                <span class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                  <UBadge
                    :label="CARD_STATUS[card.status].label"
                    :color="CARD_STATUS[card.status].color"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                    data-testid="ta-card-status"
                  />
                  <span v-if="ourLinkText(card)" class="break-words" data-testid="ta-card-linked">{{ ourLinkText(card) }}</span>
                  <span v-if="card.lastUsedAt">ใช้ล่าสุด {{ formatDateTime(card.lastUsedAt) }}</span>
                  <span v-if="card.lastError" class="break-words text-error" data-testid="ta-card-error">{{ card.lastError }}</span>
                </span>
              </div>

              <div v-if="dbOnly(card)" class="flex flex-wrap items-center gap-1">
                <UButton
                  v-if="!card.isDefault"
                  label="ตั้งเป็นค่าเริ่มต้น"
                  icon="i-lucide-star"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  :loading="busyId === card.cardId"
                  :disabled="!!busyId || card.status === 'removed' || card.status === 'expired'"
                  data-testid="ta-card-default"
                  @click="setDefault(card)"
                />
                <UButton
                  label="ลบ"
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="outline"
                  size="xs"
                  :loading="busyId === card.cardId"
                  :disabled="!!busyId"
                  data-testid="ta-card-delete"
                  @click="remove(card)"
                />
              </div>
              <span v-else class="text-xs text-muted" data-testid="ta-card-managed-tt">
                จัดการที่รายการ TikTok ด้านบน
              </span>
            </div>
          </section>
        </template>

        <p class="text-xs text-muted">
          ตั้งบัตรหลัก / ลบ ที่รายการ TikTok จะเปลี่ยนทั้งที่ TikTok และค่าเริ่มต้นของเรา · ลบแล้วย้อนกลับไม่ได้
        </p>

        <div class="flex justify-end">
          <UButton
            label="ปิด"
            color="neutral"
            variant="subtle"
            data-testid="ta-cards-close"
            @click="open = false"
          />
        </div>
      </div>
    </template>
  </UModal>

  <!-- confirm of ตั้งเป็นบัตรหลัก / ลบ (a second dialog on top of the first) -->
  <UModal
    v-model:open="confirmOpen"
    :title="confirmTitle"
    :ui="{ content: 'max-w-md' }"
    :content="confirmContent"
  >
    <template #body>
      <div class="flex flex-col gap-1 text-sm" data-testid="ta-cards-confirm-text">
        <span class="text-highlighted">{{ confirmText }}</span>
        {{ ' ' }}
        <span class="text-muted">{{ BANNER }}</span>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton
          label="ยกเลิก"
          color="neutral"
          variant="subtle"
          :disabled="!!requesting"
          data-testid="ta-cards-confirm-cancel"
          @click="confirmOpen = false"
        />
        <UButton
          :label="confirmAction === 'remove' ? 'ลบบัตร' : 'ยืนยัน'"
          :color="confirmAction === 'remove' ? 'error' : 'primary'"
          :loading="!!requesting"
          data-testid="ta-cards-confirm-ok"
          @click="onConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
