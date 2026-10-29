<script setup lang="ts">
/**
 * TASK-bc-tt-link round 2 (brief `.ai/features/_queue/bc-tt-link-ui.prompt.md` → "UI ที่ต้องทำ").
 * **เพิ่มบัญชี TikTok** under one Business Center org: show the invitation **QR** the `bcTtLink` job took inside
 * the BC, let a human scan it with the TikTok app of the account owner, then prove the link.
 *
 * Opened by the per-org button `ta-tt-link-<orgId>` of the FEAT-059 drill-down. The page did the one
 * `GET …/bc-tt-link/latest` of the click and — only when that org had no usable QR — the one `POST …/bc-tt-link`,
 * so a 409 never opens this modal (brief step 2); the answer travels in as `initial`.
 *
 * Two beats, decided with the human and **not** to be changed:
 *   1. the QR is an invitation that lives ~6 months → the job is not waited for with a held browser; while it is
 *      `waiting`/`active` this shows "กำลังเปิด Business Center เพื่อออก QR…" + the job's last log line.
 *   2. **สแกนแล้ว ตรวจสอบ** = `POST /tiktok-accounts/:id/discover { bcOrgId }` (the FEAT-059 per-org Sync, which
 *      syncs `bc_tiktok_accounts` every round) → poll `latest` until `linked.length > 0` = the account is in the
 *      DB = success. Nothing here ever links an account by itself.
 *
 * Unlike `AdvCreateModal` this modal owns its own loop: it is the whole flow (poll → QR → check → poll again),
 * it stays open across it, and the page only reacts to the three events below. It polls `latest` every 2 s while
 * the job is not terminal and while a check is in flight, never two requests at a time, and stops on close /
 * unmount. The check gives up after `CHECK_TIMEOUT_MS` and says so — the QR stays valid, so "ตรวจสอบ" can be
 * pressed again (the brief's "ยังไม่พบบัญชีใหม่" state); `account.runningJob` is a snapshot of the moment the
 * modal opened, so the timeout — not that field — is what ends the wait.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  BcOrganization,
  BcTikTokAccount,
  BcTtLinkAccepted,
  BcTtLinkConflictBody,
  BcTtLinkLatestResponse,
  DiscoverOrgBody,
  TikTokAccount
} from '#shared/types/tiktok-accounts'
import type { DiscoverJobResponse } from '#shared/types/advertisers'

const props = defineProps<{
  account: TikTokAccount | null
  /** the org row that was clicked — its `orgId` is in every URL below, its name is the modal's subtitle */
  org: BcOrganization | null
  /** answer of the one `GET …/bc-tt-link/latest` the page made for this open (after its POST, if it made one) */
  initial: BcTtLinkLatestResponse | null
}>()

const emit = defineEmits<{
  /** a new QR was ordered from in here ("ออก QR ใหม่" / "ลองใหม่") — the page toasts and follows the org */
  requested: [job: BcTtLinkAccepted]
  /** the followed job reached a terminal status → the page may re-read the account row */
  settled: []
  /** `linked.length > 0`: the scan is proven and the rows are in the DB → the page re-reads org + counts */
  linked: [accounts: BcTikTokAccount[]]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-tt-link-modal`).
const modalContent = { 'data-testid': 'ta-tt-link-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const POLL_MS = 2000
/** how long "กำลังตรวจสอบ…" waits for a row before it offers another try (the discover job owns the real work) */
const CHECK_TIMEOUT_MS = 90_000
const SCAN_HINT = 'ให้เจ้าของบัญชี TikTok เปิดแอป → โปรไฟล์ → สแกน QR นี้ (สิทธิ์: เผยแพร่โฆษณา)'

const latest = ref<BcTtLinkLatestResponse | null>(null)
/** `POST …/bc-tt-link` of "ออก QR ใหม่" / "ลองใหม่" is in flight */
const requesting = ref(false)
/** `POST …/discover` was accepted and `linked` is being waited for */
const checking = ref(false)
/** a check already ran and found nothing — the "สแกนแล้วหรือยัง?" line (reset by a new check / a new QR) */
const checkedOnce = ref(false)
const checkStartedAt = ref(0)
/** ids of the linked rows this open already knows — only rows beyond them prove *this* scan (see `pollLatest`) */
const seenLinkedIds = ref(new Set<string>())
/** text of the last failed request of this modal, shown inline next to the toast */
const actionError = ref<string | null>(null)

const job = computed(() => latest.value?.job ?? null)
const linked = computed<BcTikTokAccount[]>(() => latest.value?.linked ?? [])
const qrImage = computed<string | null>(() => job.value?.result?.qrImage ?? null)
const qrText = computed<string | null>(() => job.value?.result?.qrText ?? null)
const orgLabel = computed<string>(() => {
  const org = props.org
  if (!org) return REPORT_DASH
  return `${org.name || REPORT_DASH} (…${org.orgId.slice(-4)})`
})

/** no job yet, or one that has not reached the QR screen: the browser is still working on it */
const issuing = computed(() => {
  const j = job.value
  return !j || j.status === 'pending' || j.status === 'waiting' || j.status === 'active'
})
/**
 * Terminal without a QR — `failed` / `cancelled` (the API cancels a job when the stack is reset or a human
 * stops it), and a `completed` job whose `result` carries no image, which is a failure for this screen too.
 */
const failed = computed(() => !issuing.value && !qrImage.value)
const failedText = computed<string>(() => {
  const j = job.value
  if (!j) return 'ไม่ได้ QR'
  const detail = [j.lastLog, j.error].find(Boolean)
  if (detail) return detail
  if (j.status === 'cancelled') return 'job ถูกยกเลิก'
  return 'job จบแล้วแต่ไม่ได้รูป QR'
})
const qrFileName = computed(() => bcTtLinkQrFileName(props.org?.orgId ?? ''))

// ── the 2 s loop on `latest` ─────────────────────────────────────────────────────────────────────────────────
let timer: ReturnType<typeof setInterval> | null = null
let inFlight = false

function stopPoll() {
  if (timer) clearInterval(timer)
  timer = null
  inFlight = false
}

/** poll while the job is not terminal or while a check waits for its row — nothing else needs a loop */
const shouldPoll = computed(() => open.value && (issuing.value || checking.value))

async function pollLatest() {
  const account = props.account
  const org = props.org
  if (!account || !org || inFlight) return
  inFlight = true
  try {
    // retry: 0 — one request per tick, ofetch must not re-issue it on 5xx
    const res = await api<BcTtLinkLatestResponse>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/organizations/${encodeURIComponent(org.orgId)}/bc-tt-link/latest`,
      { retry: 0 }
    )
    if (!open.value) return // closed meanwhile
    const wasIssuing = issuing.value
    latest.value = res
    if (wasIssuing && !issuing.value) emit('settled')
    // only rows this open has not seen yet are "the scan worked": an org that was already linked once keeps its
    // old rows in `linked` forever, and pressing ตรวจสอบ again must not celebrate them a second time
    const fresh = res.linked.filter(row => !seenLinkedIds.value.has(row.id))
    if (fresh.length) {
      seenLinkedIds.value = new Set([...seenLinkedIds.value, ...res.linked.map(a => a.id)])
      checking.value = false
      checkedOnce.value = false
      emit('linked', fresh)
    } else if (checking.value && Date.now() - checkStartedAt.value > CHECK_TIMEOUT_MS) {
      // the discover job is the one doing the work; after the budget the modal stops asking and offers a retry
      checking.value = false
      checkedOnce.value = true
    }
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    // the account / org (or the route) is gone → nothing left to follow; any other error is transient
    if (err.statusCode === 404) {
      stopPoll()
      actionError.value = err.data?.error ?? 'ไม่พบ org'
    }
  } finally {
    inFlight = false
  }
}

watch(shouldPoll, (on) => {
  if (!on) {
    stopPoll()
    return
  }
  if (timer) return
  timer = setInterval(() => {
    void pollLatest()
  }, POLL_MS)
  void pollLatest()
}, { immediate: true })

watch(open, (isOpen) => {
  if (isOpen) {
    // every open starts from the `latest` the page just read (step 4 of the brief: an existing QR shows at once)
    latest.value = props.initial
    seenLinkedIds.value = new Set((props.initial?.linked ?? []).map(a => a.id))
    checking.value = false
    checkedOnce.value = false
    requesting.value = false
    actionError.value = null
  } else {
    stopPoll()
  }
})
// the page sets `initial` and `open` in the same tick; a later answer (another org's button) must win
watch(() => props.initial, (value) => {
  if (!open.value) return
  latest.value = value
  seenLinkedIds.value = new Set((value?.linked ?? []).map(a => a.id))
})

onUnmounted(stopPoll)

function errorText(e: unknown, fallback: string): string {
  const err = e as FetchError<Partial<BcTtLinkConflictBody & ApiErrorBody>>
  const reason = err.data?.reason
  return err.data?.error ?? (reason ? bcTtLinkReasonText(reason) : null) ?? err.message ?? fallback
}

/** "ออก QR ใหม่" / "ลองใหม่" — one POST, then the loop takes over again (409 stays in here as a toast) */
async function onRequest() {
  const account = props.account
  const org = props.org
  if (!account || !org || requesting.value) return
  requesting.value = true
  actionError.value = null
  try {
    // retry: 0 — exactly one POST per click (ofetch would otherwise queue a second job on 5xx)
    const res = await api<BcTtLinkAccepted>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/organizations/${encodeURIComponent(org.orgId)}/bc-tt-link`,
      { method: 'POST', retry: 0 }
    )
    // drop the old job so the screen goes back to "กำลังเปิด Business Center…" until `latest` carries the new one
    latest.value = { job: null, linked: [] }
    checking.value = false
    checkedOnce.value = false
    emit('requested', res)
  } catch (e) {
    const text = errorText(e, 'ขอ QR ไม่สำเร็จ')
    actionError.value = text
    toast.add({ title: 'ขอ QR เพิ่มบัญชี TikTok ไม่สำเร็จ', description: text, color: 'error' })
  } finally {
    requesting.value = false
  }
}

/** "สแกนแล้ว ตรวจสอบ" — the FEAT-059 per-org discover, then wait for `linked` */
async function onCheck() {
  const account = props.account
  const org = props.org
  if (!account || !org || checking.value) return
  actionError.value = null
  checkedOnce.value = false
  try {
    // retry: 0 — exactly one POST per click
    await api<DiscoverJobResponse>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/discover`,
      { method: 'POST', retry: 0, body: { bcOrgId: org.orgId } satisfies DiscoverOrgBody }
    )
    checking.value = true
    checkStartedAt.value = Date.now()
  } catch (e) {
    const text = errorText(e, 'ตรวจสอบไม่สำเร็จ')
    actionError.value = text
    toast.add({ title: 'ตรวจสอบกับ Business Center ไม่ได้', description: text, color: 'error' })
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="เพิ่มบัญชี TikTok"
    description="ออก QR ให้เจ้าของบัญชี TikTok สแกน เพื่อเชื่อมโยงบัญชีที่มีอยู่เข้ากับ Business Center org นี้"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4 text-sm">
        <p class="text-muted">
          ภายใต้:
          <span
            class="font-medium text-highlighted"
            data-testid="ta-tt-link-org"
            :data-org-id="org?.orgId ?? ''"
          >
            {{ orgLabel }}
          </span>
        </p>

        <!-- 1. the job is still working inside the Business Center -->
        <div
          v-if="issuing"
          class="flex flex-col items-center gap-2 py-6 text-center"
          data-testid="ta-tt-link-waiting"
        >
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-primary" />
          <p class="text-highlighted">
            กำลังเปิด Business Center เพื่อออก QR…
          </p>
          <p
            v-if="job?.lastLog"
            class="max-w-sm text-xs text-muted"
            data-testid="ta-tt-link-log"
          >
            {{ job.lastLog }}
          </p>
          <p class="text-xs text-dimmed">
            ปิดหน้านี้ได้ — QR ไม่หาย เปิดดูอีกครั้งได้จากปุ่มเดิม
          </p>
        </div>

        <!-- 2. terminal without a QR -->
        <UAlert
          v-else-if="failed"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="ออก QR ไม่สำเร็จ"
          :description="failedText"
          role="alert"
          data-testid="ta-tt-link-failed"
        />

        <!-- 3. proven: the rows are in the DB (the QR below stays usable for the next account) -->
        <div v-if="linked.length" class="space-y-2">
          <p class="flex items-center gap-2 font-medium text-highlighted" data-testid="ta-tt-link-success">
            <UIcon name="i-lucide-circle-check" class="size-5 shrink-0 text-success" />
            เชื่อมโยงสำเร็จ
          </p>
          <ul class="divide-y divide-default rounded-md border border-default" data-testid="ta-tt-link-linked">
            <li
              v-for="tt in linked"
              :key="tt.id"
              class="flex items-center gap-2 px-3 py-2"
              data-testid="ta-tt-link-linked-row"
              :data-asset-id="tt.assetId"
            >
              <UAvatar
                :src="tt.avatar ?? undefined"
                :alt="bcTtAccountName(tt)"
                size="sm"
              />
              <span class="flex min-w-0 flex-col">
                <span class="truncate font-medium text-highlighted">{{ bcTtAccountName(tt) }}</span>
                <span class="truncate text-xs text-muted">
                  {{ bcTtAccountHandle(tt) }}
                  <template v-if="bcTtRelationText(tt.relationStatus)">
                    · {{ bcTtRelationText(tt.relationStatus) }}
                  </template>
                </span>
              </span>
            </li>
          </ul>
        </div>

        <!-- 4. the QR itself — stays on screen while a check runs and after a success: the invitation is valid for months -->
        <div v-if="qrImage" class="flex flex-col items-center gap-3">
          <img
            :src="qrImage"
            alt="QR เพิ่มบัญชี TikTok"
            class="size-60 max-w-full rounded-md bg-white object-contain p-2"
            data-testid="ta-tt-link-qr"
          >
          <p class="text-center text-highlighted">
            {{ SCAN_HINT }}
          </p>
          <p
            v-if="qrText"
            class="text-center text-xs text-muted"
            data-testid="ta-tt-link-qrtext"
          >
            {{ qrText }}
          </p>

          <p
            v-if="checking"
            class="flex items-center gap-2 text-xs text-muted"
            data-testid="ta-tt-link-checking"
          >
            <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin text-primary" />
            กำลังตรวจสอบกับ Business Center…
          </p>
          <p
            v-else-if="checkedOnce"
            class="text-center text-xs text-warning"
            data-testid="ta-tt-link-none"
          >
            ยังไม่พบบัญชีใหม่ — สแกนแล้วหรือยัง? กดตรวจสอบอีกครั้งได้
          </p>
        </div>

        <UAlert
          v-if="actionError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="actionError"
          role="alert"
          data-testid="ta-tt-link-error"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton
          label="ปิด"
          color="neutral"
          variant="subtle"
          data-testid="ta-tt-link-close"
          @click="open = false"
        />
        <UButton
          v-if="failed"
          label="ลองใหม่"
          icon="i-lucide-refresh-cw"
          color="primary"
          :loading="requesting"
          data-testid="ta-tt-link-retry"
          @click="onRequest"
        />
        <template v-if="qrImage">
          <UButton
            label="ดาวน์โหลด QR"
            icon="i-lucide-download"
            color="neutral"
            variant="outline"
            :href="qrImage"
            :download="qrFileName"
            external
            data-testid="ta-tt-link-download"
          />
          <UButton
            label="ออก QR ใหม่"
            icon="i-lucide-qr-code"
            color="neutral"
            variant="outline"
            :loading="requesting"
            :disabled="checking"
            data-testid="ta-tt-link-renew"
            @click="onRequest"
          />
          <UButton
            label="สแกนแล้ว ตรวจสอบ"
            icon="i-lucide-scan-line"
            color="primary"
            :loading="checking"
            :disabled="requesting"
            data-testid="ta-tt-link-check"
            @click="onCheck"
          />
        </template>
      </div>
    </template>
  </UModal>
</template>
