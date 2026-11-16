<script setup lang="ts">
/**
 * FEAT-101 — mssg site editor (`/mssg-pages/sites/[siteId]`, test-id prefix `me-`; spec "UI behaviour", D4, D6, D11,
 * D12, AC-10, AC-11, AC-15..19; api-contract.md v1 §2, §3, §5).
 *
 * One `GET /mssg-sites/:id` per open (`useMssgDraft`). Contract v1.1: the account-wide busy state (AC-19) comes from
 * `view.account.job` (any mssg job type; the site view is re-read every 2 s while it is open); `GET /mssg-accounts/:id`
 * is read only for the FEAT-100 relogin modal (and followed while that relogin runs). Edits are a draft in
 * Apollo: the composable autosaves the op list (`PUT …/draft`, debounced, `rev`), "ทิ้งร่าง" deletes it, "บันทึก"
 * confirms destructive ops (AC-15) and starts one `mssgApply` job that is followed every 2 s until it ends; its
 * outcome (ok / conflict / validation / partial / session expired / other) is shown here without a reload (AC-18).
 *
 * Area (FEAT-100): a site belongs to its account's area; the API scopes `/mssg-sites/:id` by it (Admin: other area →
 * 404 → "ไม่พบเว็บนี้"). A GOD in another area sees the warning banner; `?workspaceId=` is navigation context only
 * (the back link), never sent — contract v1 has no such query on site routes. Payment admins never get here
 * (`mssg-pages-access`).
 *
 * Step 2 (B2): pages and blocks (`MssgEditorPagesStep`); the page selected there is also the one the mobile preview
 * shows. Step 3 (B3) page look and step 4 (B3) SEO / tracking / embed code; step 5 (B4) store, products and customer data (`MssgEditorStoreStep`, "ดึงข้อมูลร้านค้าใหม่" = `POST …/store/read` followed like an apply). The current step lives in `?step=` so a reload stays on it.
 * "แก้ไขล่าสุดโดย" = `lastSuccessfulApply` (v1.1; kept after a failed save).
 *
 * B5 (M5, AC-34..37, D6; contract §4.2 / §4.3 / §4.6): step 1 own domain (`MssgEditorDomainSection`: connect / check /
 * disconnect = `mssgDomain` job), duplicate (confirm → `mssgSiteDuplicate`; on success the copy = the account's site
 * that was not there before the request → link to its editor) and delete website (`MssgEditorDeleteSiteModal`: exact
 * name → `mssgSiteDelete`; the poll's 404 at its end sends the user back to `/mssg-pages` with a notice). All three are
 * disabled with the reason while the account / site is busy (contract v1.6 #9: `view.account.job` of any type), the
 * account is not connected or the site is gone; delete also for a GOD outside their own area (403 `ownAreaOnly`). A
 * failed lifecycle job shows in `me-apply-error` (`data-type` = its job type) with the Thai text of `lastError.code`.
 */
import type { MssgAccountView, MssgSite } from '#shared/types/mssg-accounts'
import type { MssgSiteView, MssgStepNo } from '#shared/types/mssg-sites'
import type { MssgSiteSettingsForm } from '~/utils/mssg-sites'
import type { MssgDomainAction } from '~/composables/useMssgDraft'

useSeoMeta({ title: 'แก้ไขเว็บ · mssg Pages' })
definePageMeta({ middleware: 'mssg-pages-access' })

const api = useApi()
const auth = useAuth()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const siteId = computed(() => String(route.params.siteId ?? ''))
const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))
const meId = computed(() => auth.admin.value?.id ?? '')
const homeWorkspaceId = computed(() => auth.context.value?.homeWorkspaceId ?? auth.admin.value?.homeWorkspaceId ?? '')

// ── outcome of the followed job ──────────────────────────────────────────────────────────────────────────────────────
const noticeOk = ref(false)

function onJobEnd(v: MssgSiteView) {
  const job = v.job
  if (!job) return
  if (mssgIsLifecycleJob(job.type)) {
    onLifecycleEnd(v)
    return
  }
  if (job.type !== 'mssgApply') {
    const isStore = job.type === 'mssgStoreRead'
    if (job.status === 'completed') toast.add({ title: isStore ? 'ดึงข้อมูลร้านค้าแล้ว' : 'งานเสร็จแล้ว', color: 'success' })
    else toast.add({ title: isStore ? 'ดึงข้อมูลร้านค้าไม่สำเร็จ' : 'งานไม่สำเร็จ', description: mssgErrorText(v.lastError?.code), color: 'error' })
    if (!isStore || job.status === 'completed') return
    if (v.lastError?.code === 'mssgSessionExpired') void loadAccount()
    return
  }
  const la = v.lastApply && v.lastApply.jobId === job.id ? v.lastApply : null
  if (job.status === 'completed' && (!la || la.status === 'ok')) {
    noticeOk.value = true
    toast.add({ title: MSSG_EDITOR_TEXT.saved, color: 'success' })
    return
  }
  if (job.status === 'cancelled') {
    toast.add({ title: 'งานบันทึกถูกยกเลิก', description: 'ร่างยังอยู่ครบ กดบันทึกใหม่ได้', color: 'warning' })
    return
  }
  if (la?.status === 'conflict' || v.conflict) {
    toast.add({ title: 'ค่าบน mssg เปลี่ยนไป', description: MSSG_ERROR_TEXT.mssgConflict, color: 'warning' })
    return
  }
  const code = la?.error?.code ?? v.lastError?.code
  toast.add({
    title: la?.status === 'partial' ? 'บันทึกได้บางส่วน' : 'บันทึกไปที่ mssg ไม่สำเร็จ',
    description: mssgErrorText(code),
    color: 'error'
  })
  if (code === 'mssgSessionExpired') void loadAccount()
}

const draft = useMssgDraft(siteId, {
  onJobEnd,
  onPollTimeout: () => toast.add({ title: MSSG_POLL_TIMEOUT_TEXT, color: 'warning' }),
  onAccountJobEnd: () => {
    // a relogin modal that is open shows the account: refresh it
    if (account.value) void loadAccount()
  },
  // B5: the 404 at the end of a delete this page requested is its success
  onGone: () => {
    if (!deleteRequested.value) return false
    leaveAfterDelete()
    return true
  }
})
const view = draft.view

// ── account (relogin modal only; the busy state comes from `view.account.job`, v1.1) ────────────────────────────────
const account = ref<MssgAccountView | null>(null)
let accountSeq = 0

async function loadAccount() {
  const id = view.value?.accountId
  if (!id) return
  const s = ++accountSeq
  try {
    const acc = await api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(id)}`, { retry: 0 })
    if (s !== accountSeq) return
    account.value = acc
  } catch {
    // non-fatal: the API still answers 409 `jobInProgress` on apply
  }
}

const accountPoll = useMssgPoll({
  read: id => api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(id)}`, { retry: 0 }),
  onUpdate: (acc) => {
    account.value = acc
  },
  onEnd: (acc) => {
    // a relogin / sync of the account ended: the site view's account status (and maybe `live`) changed
    if (acc.job?.status === 'completed') void draft.reload()
  },
  onGone: () => {
    account.value = null
    void draft.reload()
  }
})
watch(() => account.value && mssgNeedsPoll(account.value) ? account.value.id : '', id => accountPoll.track(id ? [id] : []))

/** AC-19: a job of the account is open (v1.1 `view.account.job`, or the relogin this page started) */
const accountBusy = computed(() => draft.accountJobOpen.value || (!!account.value && mssgNeedsPoll(account.value)))
/** the account's job when it is not this site's own (that one has its own progress line) */
const accountJobLine = computed(() => {
  const job = view.value?.account?.job
  if (!job || !mssgJobIsOpen(job) || draft.jobOpen.value || job.id === view.value?.job?.id) return null
  return { type: job.type, text: mssgJobTypeText(job.type), progress: mssgJobProgressText(job) }
})

// ── relogin (FEAT-100 modal) ─────────────────────────────────────────────────────────────────────────────────────────
const reloginOpen = ref(false)
const needsRelogin = computed(() => {
  const v = view.value
  if (!v) return false
  return v.account?.status === 'expired' || v.account?.status === 'error'
    || (v.lastApply?.error?.code === 'mssgSessionExpired' && v.account?.status !== 'connected')
})
async function openRelogin() {
  if (!account.value) await loadAccount()
  if (account.value) reloginOpen.value = true
  else toast.add({ title: 'โหลดบัญชี mssg ไม่สำเร็จ', description: 'ลองใหม่อีกครั้ง', color: 'error' })
}
function onReloginRequested(acc: MssgAccountView) {
  account.value = acc
  accountPoll.follow(acc.id)
}

// ── steps (URL state) ───────────────────────────────────────────────────────────────────────────────────────────────
const step = computed<MssgStepNo>(() => {
  const n = Number(route.query.step)
  return (n >= 1 && n <= 5 ? n : 1) as MssgStepNo
})
function goStep(n: number) {
  const next = Math.min(5, Math.max(1, n))
  void router.replace({ query: { ...route.query, step: next === 1 ? undefined : String(next) } })
}
const currentStep = computed(() => MSSG_EDITOR_STEPS[step.value - 1]!)

/** field errors + conflict items per step (red counts in the nav) */
const problems = computed(() => {
  const out: Partial<Record<MssgStepNo, number>> = {}
  for (const e of draft.fieldErrors.value) out[e.step] = (out[e.step] ?? 0) + 1
  for (const item of view.value?.conflict?.items ?? []) {
    const n = mssgConflictStep(item, draft.ops.value)
    out[n] = (out[n] ?? 0) + 1
  }
  return out
})

const step1Errors = computed(() => {
  const out: Partial<Record<keyof MssgSiteSettingsForm, string>> = {}
  for (const e of draft.fieldErrors.value) {
    if (e.step !== 1) continue
    const key = mssgStep1Key(e.path)
    if (key && !out[key]) out[key] = e.message
  }
  return out
})
/** B2: step-2 errors that land on a page / block of the draft (the sheet shows them in place) */
const step2Errors = computed(() => draft.fieldErrors.value.filter(e => e.step === 2))
function placedOnStep2(e: { path: string, target: { pageId: string | null } }) {
  // v1.6: menu errors are shown in the step's "เมนู" section
  if (!e.target.pageId && /^menu(\.|$)/.test(e.path)) return !!draft.localSite.value?.menu
  return !!e.target.pageId && !!draft.localSite.value?.pages.some(p => p.id === e.target.pageId)
}
/** M3: step-3 errors (page background) land on the selected page's field; step-4 errors on their site field path */
const step3Errors = computed(() => draft.fieldErrors.value.filter(e => e.step === 3))
/** M4: step-5 errors on a product (draft 400 `ops.<n>.…` of a product op, apply `products.<id>.<key>`, v1.4) */
const step5Errors = computed(() => draft.fieldErrors.value.filter(e => e.step === 5))
const store = computed(() => view.value?.store ?? null)
/** the products the editor shows: last store read + the draft's product ops (names for labels / the destructive list) */
const localProducts = computed(() => mssgApplyProductOps(store.value?.products ?? [], draft.ops.value, mssgStoreCurrency(store.value)))
/** step-3 fields with a place of their own (B3 background; v1.6 preset, auto pair, font) */
const STEP3_FIELDS = ['theme.page.backgroundColor', 'theme.page.backgroundImage', 'theme.colorId', 'theme.light', 'theme.dark', 'theme.page.font', 'theme.page.font.family', 'theme.page.font.provider']
const STEP4_FIELDS = ['seo.title', 'seo.description', 'seo.indexing', 'seo.faviconUrl', 'seo.ogImageUrl', 'tracking.tiktok', 'tracking.facebook', 'tracking.google', 'embeddedCode.content', 'embeddedCode.inHead', 'embeddedCode.onLoad']
const step4Errors = computed(() => {
  const out: Record<string, string> = {}
  for (const e of draft.fieldErrors.value) {
    if (e.step === 4 && !out[e.path]) out[e.path] = e.message
  }
  return out
})
/** field errors of the current step that have no field of their own (shown above the form) */
const otherStepErrors = computed(() => draft.fieldErrors.value.filter((e) => {
  if (e.step !== step.value) return false
  if (e.step === 1) return !mssgStep1Key(e.path)
  if (e.step === 2) return !placedOnStep2(e)
  if (e.step === 3) return !(e.target.pageId === selectedPageId.value && STEP3_FIELDS.includes(e.target.field))
  if (e.step === 4) return !STEP4_FIELDS.includes(e.path)
  if (e.step === 5) return !(e.target.productId && localProducts.value.some(p => p.id === e.target.productId))
  return true
}))
/** the page selected in step 2 (also shown by the mobile preview while on step 2) */
const selectedPageId = ref('')
const errorSites = computed(() => [draft.localSite.value, view.value?.live])
const errorProducts = computed(() => [...localProducts.value, ...(store.value?.products ?? [])])

// ── step 5 (M4): store read, "+ เพิ่ม block Form" ─────────────────────────────────────────────────────────────────────
const storeReading = computed(() => draft.jobOpen.value && view.value?.job?.type === 'mssgStoreRead')
const storeReadError = computed(() => {
  const j = view.value?.job
  if (!j || j.type !== 'mssgStoreRead' || j.status !== 'failed') return null
  const code = view.value?.lastError?.code ?? ''
  return { code, text: mssgErrorText(code || undefined) }
})
/** a save went through after the last read: the stored list may not match mssg any more */
const storeStale = computed(() => {
  const at = view.value?.lastSuccessfulApply?.at
  const read = store.value?.readAt
  return !!at && !!read && new Date(at).getTime() > new Date(read).getTime()
})
const storeReadBlocked = computed<string | null>(() => {
  const v = view.value
  if (!v) return 'กำลังโหลด'
  if (v.gone) return MSSG_CONFLICT_TEXT.siteGone
  if (v.account?.status !== 'connected') return MSSG_CONFLICT_TEXT.notConnected
  if (draft.jobOpen.value) return mssgOwnJobText(v.job)
  if (accountBusy.value) return MSSG_CONFLICT_TEXT.jobInProgress
  if (draft.requesting.value) return 'กำลังทำงานอยู่'
  return null
})
async function onReadStore() {
  if (storeReadBlocked.value) return
  const res = await draft.readStore()
  if (!res.ok) toast.add({ title: 'ดึงข้อมูลร้านค้าไม่ได้', description: res.message, color: res.status === 409 ? 'warning' : 'error' })
}
/** "+ เพิ่ม block Form" (Audience empty state): step 2 with the SubscriptionForm kind preselected */
const startKind = ref<string | null>(null)
const addFormDisabled = computed(() => draft.readOnly.value || !draft.localSite.value?.pages?.length)
function onAddForm() {
  if (addFormDisabled.value) return
  startKind.value = 'SubscriptionForm'
  goStep(2)
}

// ── site lifecycle (B5, M5) ─────────────────────────────────────────────────────────────────────────────────────────
/** what every lifecycle control waits for, or `null` (the API's 409 stays the authority) */
const lifecycleBlocked = computed<string | null>(() => {
  const v = view.value
  if (!v) return 'กำลังโหลด'
  if (v.gone) return MSSG_CONFLICT_TEXT.siteGone
  if (v.account?.status !== 'connected') return MSSG_CONFLICT_TEXT.notConnected
  if (draft.jobOpen.value) return mssgOwnJobText(v.job)
  if (accountBusy.value) return MSSG_CONFLICT_TEXT.jobInProgress
  if (draft.requesting.value) return 'กำลังทำงานอยู่'
  return null
})
/** a 403 `ownAreaOnly` came back although the page did not expect it (e.g. stale area data) */
const ownAreaRefused = ref(false)
const deleteBlocked = computed(() => (isOtherArea.value || ownAreaRefused.value ? MSSG_FORBIDDEN_TEXT.ownAreaOnly : lifecycleBlocked.value))
/** the site's own lifecycle job while it is open */
const lifecycleRunning = computed(() => {
  const j = view.value?.job
  return draft.jobOpen.value && j && mssgIsLifecycleJob(j.type) ? j.type : null
})
/** a failed lifecycle job of this site (the site's last job), shown in `me-apply-error` */
const lifecycleProblem = computed(() => {
  const v = view.value
  const j = v?.job
  if (!v || !j || !mssgIsLifecycleJob(j.type) || j.status !== 'failed') return null
  const code = v.lastError?.code ?? ''
  return {
    type: j.type,
    code,
    title: mssgLifecycleFailTitle(j.type),
    text: mssgErrorText(code || undefined),
    detail: v.lastError?.message ?? ''
  }
})

/** the account's Apollo site ids (for the duplicate's "which one is the copy"); `null` when it could not be read */
async function accountSites(): Promise<MssgSite[] | null> {
  const id = view.value?.accountId
  if (!id) return null
  try {
    const acc = await api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(id)}`, { retry: 0 })
    return acc.sites
  } catch {
    return null
  }
}
function editorLink(id: string) {
  const ws = isOtherArea.value ? view.value?.workspaceId : ''
  return { path: `/mssg-pages/sites/${encodeURIComponent(id)}`, query: ws ? { workspaceId: ws } : undefined }
}

// duplicate
const duplicateOpen = ref(false)
let duplicateBaseline: string[] | null = null
const duplicateDone = ref<{ copy: MssgSite | null } | null>(null)
async function onDuplicateConfirm() {
  if (lifecycleBlocked.value) {
    duplicateOpen.value = false
    return
  }
  duplicateDone.value = null
  const before = await accountSites()
  const res = await draft.duplicate()
  duplicateOpen.value = false
  if (res.ok) {
    duplicateBaseline = before ? before.map(x => x.id).filter((x): x is string => !!x) : null
    toast.add({ title: 'สั่งทำสำเนาเว็บแล้ว', description: 'สำเนาจะขึ้นในบัญชีนี้เมื่อเสร็จ', color: 'info' })
  } else {
    toast.add({ title: 'ทำสำเนาเว็บไม่ได้', description: res.message, color: res.status === 409 ? 'warning' : 'error' })
  }
}

// delete
const deleteOpen = ref(false)
const deleteError = ref<string | null>(null)
const deleteRequested = ref(false)
let deleteBack: ReturnType<typeof backToFor> | null = null
let deletedName = ''
function openDelete() {
  if (deleteBlocked.value) return
  deleteError.value = null
  deleteOpen.value = true
}
async function onDeleteConfirm(name: string) {
  deleteError.value = null
  const back = backTo.value
  const siteName = view.value?.live?.name ?? view.value?.name ?? name
  const res = await draft.deleteSite(name)
  if (res.ok) {
    deleteOpen.value = false
    deleteRequested.value = true
    deleteBack = back
    deletedName = siteName
    toast.add({ title: 'สั่งลบเว็บแล้ว', description: 'กลับไปรายการเว็บเมื่อ mssg ลบเสร็จ', color: 'info' })
    return
  }
  if (res.status === 403 && res.reason === 'ownAreaOnly') ownAreaRefused.value = true
  deleteError.value = res.message ?? MSSG_LIFECYCLE_TEXT.deleteFailed
}
function leaveAfterDelete() {
  if (!deleteRequested.value) return
  deleteRequested.value = false
  const notice = { kind: 'deleted' as const, title: MSSG_LIFECYCLE_TEXT.deleteOk, description: `"${deletedName}" ถูกลบจาก mssg และจาก Apollo แล้ว`, color: 'success' as const }
  useMssgPagesNotice().value = notice
  toast.add({ title: notice.title, description: notice.description, color: 'success' })
  void router.push(deleteBack ?? { path: '/mssg-pages' })
}

// own domain
let domainAction: MssgDomainAction | null = null
async function onDomain(action: MssgDomainAction, name?: string) {
  if (lifecycleBlocked.value) return
  domainAction = action
  const res = await draft.domain(action, name)
  if (!res.ok) {
    domainAction = null
    toast.add({ title: MSSG_LIFECYCLE_TEXT.domainFailed, description: res.message, color: res.status === 409 ? 'warning' : 'error' })
  }
}

async function onLifecycleEnd(v: MssgSiteView) {
  const job = v.job!
  if (job.status === 'completed') {
    if (job.type === 'mssgSiteDelete') {
      leaveAfterDelete()
      return
    }
    if (job.type === 'mssgSiteDuplicate') {
      const after = await accountSites()
      const added = after ? mssgNewSites(duplicateBaseline, after) : []
      duplicateBaseline = null
      duplicateDone.value = { copy: added[0] ?? null }
      toast.add({ title: MSSG_LIFECYCLE_TEXT.duplicateOk, description: added[0]?.name, color: 'success' })
      return
    }
    const st = mssgDomainStateOf(v.domain)
    const title = domainAction === 'disconnect' ? 'ยกเลิกการเชื่อมโดเมนแล้ว' : domainAction === 'connect' ? 'ส่งคำขอเชื่อมโดเมนแล้ว' : 'ตรวจสถานะโดเมนแล้ว'
    domainAction = null
    toast.add({ title, description: st ? MSSG_DOMAIN_STATE[st].label : undefined, color: 'success' })
    return
  }
  if (job.type === 'mssgSiteDelete') deleteRequested.value = false
  if (job.type === 'mssgSiteDuplicate') duplicateBaseline = null
  if (job.type === 'mssgDomain') domainAction = null
  toast.add({
    title: mssgLifecycleFailTitle(job.type),
    description: job.status === 'cancelled' ? 'งานถูกยกเลิก' : mssgErrorText(v.lastError?.code),
    color: 'error'
  })
  if (v.lastError?.code === 'mssgSessionExpired') void loadAccount()
}

// ── header / banners ────────────────────────────────────────────────────────────────────────────────────────────────
const isOtherArea = computed(() => isGod.value && !!view.value && !!homeWorkspaceId.value && view.value.workspaceId !== homeWorkspaceId.value)
function backToFor(ws: string) {
  return ws && ws !== homeWorkspaceId.value ? { path: '/mssg-pages', query: { area: ws } } : { path: '/mssg-pages' }
}
const backTo = computed(() => backToFor(isOtherArea.value ? view.value!.workspaceId : (typeof route.query.workspaceId === 'string' ? route.query.workspaceId : '')))
const accountLabel = computed(() => (view.value ? (view.value.account?.nickname || view.value.account?.email || 'บัญชี mssg') : ''))
const lastEdit = computed(() => {
  const v = view.value
  // v1.1: the last successful apply, kept after a failed one; older views without the key fall back to `lastApply`
  if (v && v.lastSuccessfulApply !== undefined) {
    const ls = v.lastSuccessfulApply
    return ls ? { by: ls.by?.name ?? '—', at: formatDateTime(ls.at) } : null
  }
  const la = v?.lastApply
  if (!la || (la.status !== 'ok' && la.status !== 'partial')) return null
  return { by: la.by?.name ?? '—', at: formatDateTime(la.at) }
})

const now = ref(Date.now())
let clock: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  clock = setInterval(() => {
    now.value = Date.now()
  }, 30_000)
})
const otherEditor = computed(() => mssgDraftOtherEditor(view.value?.draft, meId.value, now.value))

const resultUrl = computed(() => {
  const s = draft.localSite.value
  return s ? mssgSiteUrl(s.subdomain, s.apexDomain, s.domain?.name) : ''
})

// ── apply outcome panels (persistent, from the view) ─────────────────────────────────────────────────────────────────
const applyProblem = computed(() => {
  const v = view.value
  const la = v?.lastApply
  if (!v || !la || draft.jobOpen.value || !v.draft) return null
  if (la.status !== 'failed' && la.status !== 'partial') return null
  return {
    status: la.status,
    code: la.error?.code ?? '',
    text: mssgErrorText(la.error?.code),
    detail: la.error?.code === 'mssgValidation' ? '' : (la.error?.message ?? ''),
    applied: la.appliedCount,
    remaining: v.draft.ops.length
  }
})

// ── save / discard ───────────────────────────────────────────────────────────────────────────────────────────────────
const destructive = computed(() => mssgDestructiveOps(draft.ops.value, view.value?.live, store.value?.products ?? []))
const confirmOpen = ref(false)
const discardOpen = ref(false)

const saveBlockedReason = computed<string | null>(() => {
  const v = view.value
  if (!v) return 'กำลังโหลด'
  if (v.gone) return MSSG_CONFLICT_TEXT.siteGone
  if (draft.jobOpen.value) return mssgOwnJobText(v.job)
  if (v.account?.status !== 'connected') return MSSG_CONFLICT_TEXT.notConnected
  if (accountBusy.value) return MSSG_CONFLICT_TEXT.jobInProgress
  if (v.conflict) return MSSG_CONFLICT_TEXT.conflictPending
  if (!draft.dirty.value) return MSSG_CONFLICT_TEXT.noDraft
  return null
})

async function onSave() {
  if (saveBlockedReason.value || draft.requesting.value) return
  noticeOk.value = false
  if (!(await draft.flush())) {
    toast.add({ title: 'ยังบันทึกไม่ได้', description: draft.saveError.value ?? 'แก้ช่องที่ผิดก่อนแล้วลองใหม่', color: 'error' })
    return
  }
  if (destructive.value.length) {
    confirmOpen.value = true
    return
  }
  await doApply(false)
}

async function doApply(confirmDestructive: boolean) {
  const res = await draft.apply(confirmDestructive)
  if (res.ok) {
    confirmOpen.value = false
    return
  }
  if (res.reason === 'confirmRequired') {
    confirmOpen.value = true
    return
  }
  confirmOpen.value = false
  toast.add({ title: 'บันทึกไปที่ mssg ไม่ได้', description: res.message, color: res.status === 409 ? 'warning' : 'error' })
}

async function onDiscard() {
  const res = await draft.discard()
  discardOpen.value = false
  if (res.ok) {
    noticeOk.value = false
    toast.add({ title: 'ทิ้งร่างแล้ว', description: 'กลับไปใช้ค่าปัจจุบันบน mssg', color: 'success' })
  } else {
    toast.add({ title: 'ทิ้งร่างไม่ได้', description: res.message, color: 'error' })
  }
}

async function onResolve(take: 'live' | 'mine') {
  const res = await draft.resolve(take)
  if (res.ok) {
    toast.add({
      title: take === 'live' ? 'ใช้ค่าจาก mssg แล้ว' : 'ใช้ค่าของคุณแล้ว',
      description: 'กด "บันทึก" อีกครั้งเพื่อส่งไปที่ mssg',
      color: 'success'
    })
  } else {
    toast.add({ title: 'เลือกค่าไม่ได้', description: res.message, color: 'error' })
  }
}

const canDiscard = computed(() => draft.dirty.value && !draft.jobOpen.value && draft.requesting.value === null)

// ── page state / lifecycle ───────────────────────────────────────────────────────────────────────────────────────────
const pageState = computed(() => draft.loadState.value)

onMounted(() => {
  void draft.load()
})

watch(siteId, (id, prev) => {
  if (id && id !== prev) {
    account.value = null
    duplicateDone.value = null
    duplicateBaseline = null
    ownAreaRefused.value = false
    void draft.load()
  }
})

function beforeUnload(e: BeforeUnloadEvent) {
  if (draft.pending.value) e.preventDefault()
}
onMounted(() => window.addEventListener('beforeunload', beforeUnload))
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload)
  if (clock) clearInterval(clock)
  accountSeq++
})
// leaving the editor: send a pending edit first (the PUT is ≤ 1 s behind anyway)
onBeforeRouteLeave(async () => {
  if (draft.pending.value) await draft.flush()
})
</script>

<template>
  <UDashboardPanel id="mssg-editor">
    <template #header>
      <UDashboardNavbar title="แก้ไขเว็บ" :ui="{ title: 'min-w-0 truncate' }">
        <template #leading>
          <UDashboardSidebarCollapse />
          <UButton
            icon="i-lucide-chevron-left"
            color="neutral"
            variant="outline"
            size="sm"
            :to="backTo"
            aria-label="กลับไปรายการเว็บ"
            data-testid="me-back"
          />
        </template>
        <template #right>
          <UButton
            v-if="pageState === 'ready'"
            label="ทิ้งร่าง"
            icon="i-lucide-trash-2"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="!canDiscard"
            :title="canDiscard ? undefined : (draft.jobOpen.value ? mssgOwnJobText(view?.job) : 'ยังไม่มีร่าง')"
            data-testid="me-discard"
            @click="discardOpen = true"
          />
          <UButton
            v-if="pageState === 'ready'"
            label="บันทึก"
            icon="i-lucide-save"
            size="sm"
            :loading="draft.requesting.value === 'apply' || draft.jobOpen.value"
            :disabled="!!saveBlockedReason || draft.requesting.value !== null"
            :title="saveBlockedReason ?? 'ส่งร่างทั้งหมดไปที่ mssg'"
            :data-reason="saveBlockedReason ?? ''"
            data-testid="me-save"
            @click="onSave"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="me-page"
        :data-state="pageState"
        :data-site-id="siteId"
        :data-job-status="view?.job?.status ?? ''"
        :data-polling="draft.polling.value ? 'true' : 'false'"
        :data-rev="view?.draft?.rev ?? ''"
        :data-readonly="draft.readOnly.value ? 'true' : 'false'"
        class="flex min-w-0 flex-1 flex-col gap-4"
      >
        <!-- loading -->
        <div v-if="pageState === 'loading'" class="flex flex-col gap-3" data-testid="me-loading">
          <USkeleton class="h-14 w-full rounded-lg" />
          <div class="flex flex-wrap gap-4">
            <USkeleton class="h-72 min-w-0 flex-[1_1_210px] rounded-lg" />
            <USkeleton class="h-72 min-w-0 flex-[999_1_420px] rounded-lg" />
          </div>
        </div>

        <!-- 404 -->
        <div
          v-else-if="pageState === 'notFound'"
          class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default px-4 py-10 text-center"
          data-testid="me-notfound"
        >
          <UIcon name="i-lucide-search-x" class="size-8 text-dimmed" />
          <p class="font-medium text-highlighted">
            {{ MSSG_EDITOR_TEXT.notFound }}
          </p>
          <p class="text-sm text-muted">
            เว็บนี้อาจถูกลบไปแล้ว หรืออยู่ในพื้นที่ที่คุณไม่มีสิทธิ์ดู
          </p>
          <UButton
            label="กลับไปรายการเว็บ"
            variant="soft"
            to="/mssg-pages"
            data-testid="me-notfound-back"
          />
        </div>

        <!-- error -->
        <UAlert
          v-else-if="pageState === 'error'"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="MSSG_EDITOR_TEXT.loadFailed"
          :description="draft.loadError.value && draft.loadError.value !== MSSG_EDITOR_TEXT.loadFailed ? draft.loadError.value : undefined"
          data-testid="me-error"
        >
          <template #actions>
            <UButton
              label="ลองใหม่"
              icon="i-lucide-refresh-cw"
              color="error"
              size="xs"
              :loading="draft.loading.value"
              data-testid="me-error-retry"
              @click="draft.reload()"
            />
          </template>
        </UAlert>

        <!-- ready -->
        <template v-else-if="view">
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="me-header">
            <span class="flex min-w-0 flex-[1_1_240px] flex-col gap-0.5">
              <span class="text-xs break-words text-muted" data-testid="me-owner">{{ view.owner?.name || '—' }} › {{ accountLabel }}</span>
              <span class="text-lg font-semibold break-words text-highlighted">
                <span data-testid="me-site-name">{{ view.name }}</span>
                <span class="text-sm font-normal break-all text-muted"> · <span data-testid="me-site-url">{{ view.url }}</span></span>
              </span>
            </span>
            <span v-if="lastEdit" class="text-xs text-muted" data-testid="me-last-edit">แก้ไขล่าสุดโดย {{ lastEdit.by }} · {{ lastEdit.at }}</span>
            <UButton
              v-if="view.url"
              label="เปิดดูเว็บ"
              icon="i-lucide-external-link"
              color="neutral"
              variant="outline"
              size="sm"
              :to="view.url"
              target="_blank"
              rel="noopener noreferrer"
              external
              data-testid="me-open-site"
            />
          </div>

          <div
            v-if="isOtherArea"
            role="status"
            class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
            data-testid="me-banner"
          >
            <span class="min-w-0 flex-1 basis-64 text-sm break-words text-warning">
              เว็บนี้เป็นของ <strong data-testid="me-banner-name">{{ view.owner?.name || '…' }}</strong>
              · คุณกำลังแก้ไขแทนในฐานะผู้ดูแล ทุกการแก้ไขจะบันทึกชื่อคุณ
            </span>
          </div>

          <UAlert
            v-if="otherEditor"
            color="warning"
            variant="subtle"
            icon="i-lucide-users"
            :title="`${otherEditor} กำลังแก้ร่างนี้อยู่ · แก้พร้อมกันอาจทับกัน`"
            data-testid="me-draft-other"
          />

          <UAlert
            v-if="view.gone"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-off"
            :title="MSSG_EDITOR_TEXT.gone"
            data-testid="me-gone"
          />
          <UAlert
            v-else-if="draft.readOnlyReason.value && !draft.jobOpen.value"
            color="warning"
            variant="subtle"
            icon="i-lucide-lock"
            :title="draft.readOnlyReason.value"
            data-testid="me-readonly"
          >
            <template v-if="needsRelogin" #actions>
              <UButton
                label="เข้าสู่ระบบใหม่"
                icon="i-lucide-log-in"
                color="warning"
                size="xs"
                data-testid="me-relogin"
                @click="openRelogin"
              />
            </template>
          </UAlert>

          <div
            v-if="draft.jobOpen.value"
            role="status"
            class="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
            data-testid="me-job-status"
            :data-step="view.job?.step ?? ''"
            :data-status="view.job?.status ?? ''"
          >
            <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
            <span class="min-w-0 break-words">{{ mssgOwnJobText(view.job) }} · {{ mssgJobProgressText(view.job) }}</span>
          </div>
          <div
            v-if="accountJobLine"
            role="status"
            class="flex items-center gap-2 rounded-lg border border-info/40 bg-info/10 px-4 py-3 text-sm text-info"
            data-testid="me-account-busy"
            :data-type="accountJobLine.type"
          >
            <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
            <span class="min-w-0 break-words">{{ accountJobLine.text }} · {{ accountJobLine.progress }} · แก้ร่างต่อได้ กด "บันทึก" ได้เมื่องานนี้เสร็จ</span>
          </div>
          <div
            v-if="draft.pollTimedOut.value"
            role="status"
            class="flex flex-wrap items-center gap-2 rounded-lg border border-default px-4 py-2 text-sm text-warning"
            data-testid="me-poll-timeout"
          >
            <span class="min-w-0 flex-1">{{ MSSG_POLL_TIMEOUT_TEXT }}</span>
            <UButton
              label="รีเฟรช"
              icon="i-lucide-rotate-cw"
              color="warning"
              variant="outline"
              size="xs"
              data-testid="me-poll-reload"
              @click="draft.reload()"
            />
          </div>

          <div
            v-if="noticeOk"
            role="status"
            class="flex items-center gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success"
            data-testid="me-notice-ok"
          >
            <span class="min-w-0 flex-1">{{ MSSG_EDITOR_TEXT.saved }}</span>
            <UButton
              label="ปิด"
              color="neutral"
              variant="outline"
              size="xs"
              @click="noticeOk = false"
            />
          </div>

          <div
            v-if="duplicateDone"
            role="status"
            class="flex flex-wrap items-center gap-3 rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-sm text-success"
            data-testid="me-duplicate-done"
            :data-copy-id="duplicateDone.copy?.id ?? ''"
          >
            <span class="min-w-0 flex-1 basis-56 break-words">
              {{ MSSG_LIFECYCLE_TEXT.duplicateOk }}<template v-if="duplicateDone.copy"> · <strong>{{ duplicateDone.copy.name }}</strong></template>
            </span>
            <UButton
              v-if="duplicateDone.copy?.id"
              label="เปิดแก้ไขสำเนา"
              icon="i-lucide-arrow-right"
              trailing
              color="success"
              variant="outline"
              size="xs"
              :to="editorLink(duplicateDone.copy.id)"
              data-testid="me-duplicate-open"
            />
            <UButton
              v-else
              label="ดูในรายการเว็บ"
              icon="i-lucide-list"
              color="success"
              variant="outline"
              size="xs"
              :to="backTo"
              data-testid="me-duplicate-list"
            />
            <UButton
              label="ปิด"
              color="neutral"
              variant="outline"
              size="xs"
              data-testid="me-duplicate-done-close"
              @click="duplicateDone = null"
            />
          </div>

          <UAlert
            v-if="lifecycleProblem"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="lifecycleProblem.title"
            :data-code="lifecycleProblem.code"
            data-status="failed"
            :data-type="lifecycleProblem.type"
            data-testid="me-apply-error"
          >
            <template #description>
              <span class="flex flex-col gap-1">
                <span class="break-words">{{ lifecycleProblem.text }}</span>
                <span v-if="lifecycleProblem.detail" class="text-xs break-words opacity-80">{{ lifecycleProblem.detail }}</span>
              </span>
            </template>
            <template v-if="lifecycleProblem.code === 'mssgSessionExpired'" #actions>
              <UButton
                label="เข้าสู่ระบบใหม่"
                icon="i-lucide-log-in"
                color="error"
                size="xs"
                data-testid="me-apply-relogin"
                @click="openRelogin"
              />
            </template>
          </UAlert>
          <UAlert
            v-else-if="applyProblem"
            :color="applyProblem.status === 'partial' ? 'warning' : 'error'"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="applyProblem.status === 'partial' ? 'บันทึกไปที่ mssg ได้บางส่วน' : 'บันทึกไปที่ mssg ไม่สำเร็จ'"
            :data-code="applyProblem.code"
            :data-status="applyProblem.status"
            data-testid="me-apply-error"
          >
            <template #description>
              <span class="flex flex-col gap-1">
                <span class="break-words">{{ applyProblem.text }}</span>
                <span v-if="applyProblem.status === 'partial'" class="break-words" data-testid="me-partial">
                  บันทึกไปแล้ว {{ applyProblem.applied }} รายการ · เหลือ {{ applyProblem.remaining }} รายการในร่าง (ยังไม่ได้ส่งไปที่ mssg)
                </span>
                <span v-if="applyProblem.detail" class="text-xs break-words opacity-80">{{ applyProblem.detail }}</span>
              </span>
            </template>
            <template v-if="applyProblem.code === 'mssgSessionExpired'" #actions>
              <UButton
                label="เข้าสู่ระบบใหม่"
                icon="i-lucide-log-in"
                color="error"
                size="xs"
                data-testid="me-apply-relogin"
                @click="openRelogin"
              />
            </template>
          </UAlert>

          <MssgEditorConflictPanel
            v-if="view.conflict && view.conflict.items.length"
            :conflict="view.conflict"
            :ops="draft.ops.value"
            :sites="errorSites"
            :products="errorProducts"
            :busy="draft.requesting.value === 'resolve'"
            :disabled="draft.jobOpen.value || !!view.gone"
            @take="onResolve"
            @go-step="goStep"
          />

          <!-- draft state line -->
          <div class="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span
              v-if="draft.dirty.value"
              class="inline-flex items-center gap-1.5 text-warning"
              data-testid="me-draft-dirty"
              :data-pending="draft.pending.value ? 'true' : 'false'"
            >
              <span class="size-2 rounded-full bg-warning" aria-hidden="true" />
              {{ MSSG_EDITOR_TEXT.draftDirty }}
            </span>
            <span v-else class="text-muted" data-testid="me-draft-clean">ร่างตรงกับค่าบน mssg</span>
            <span v-if="draft.saving.value" class="text-muted" data-testid="me-draft-saving">{{ MSSG_EDITOR_TEXT.draftSaving }}</span>
            <span
              v-else-if="draft.saveError.value"
              class="text-error"
              role="alert"
              data-testid="me-draft-error"
            >{{ draft.saveError.value }}</span>
            <span v-else-if="view.draft && !draft.pending.value" class="text-muted" data-testid="me-draft-saved">
              เก็บร่างใน Apollo แล้ว · {{ formatDateTime(view.draft.updatedAt) }}
            </span>
          </div>

          <!-- nav · sheet · preview -->
          <div class="flex flex-wrap items-start gap-5">
            <div class="min-w-0 flex-[1_1_210px] lg:sticky lg:top-0">
              <MssgEditorStepsNav
                :current="step"
                :readiness="view.readiness"
                :problems="problems"
                @select="goStep"
              />
            </div>

            <section
              class="flex min-w-0 flex-[999_1_420px] flex-col rounded-lg border border-default bg-elevated/20"
              :data-testid="`me-sheet`"
              :data-step="step"
            >
              <div class="flex flex-wrap items-center gap-3 border-b border-default px-4 py-3.5">
                <UBadge :label="`ขั้นที่ ${step}`" color="primary" variant="subtle" />
                <h2 class="min-w-0 text-sm font-semibold break-words text-highlighted">
                  {{ currentStep.sheet }}
                </h2>
              </div>
              <div class="flex flex-col gap-4 px-4 pt-4">
                <UAlert
                  v-for="(e, i) in otherStepErrors"
                  :key="`${i}-${e.path}`"
                  color="error"
                  variant="subtle"
                  icon="i-lucide-circle-alert"
                  :title="`${mssgFieldErrorLabel(e, draft.ops.value, errorSites, errorProducts)}: ${e.message}`"
                  data-testid="me-step-error"
                  :data-path="e.path"
                />
                <MssgEditorSettingsStep
                  v-if="step === 1"
                  :site="draft.localSite.value"
                  :live-enabled="!!view.live?.enabled"
                  :read-only="draft.readOnly.value"
                  :errors="step1Errors"
                  :reset-token="draft.resetToken.value"
                  @update="draft.updateSite"
                >
                  <template #domain>
                    <MssgEditorDomainSection
                      :domain="view.domain"
                      :live-name="view.live?.domain?.name ?? null"
                      :blocked-reason="lifecycleBlocked"
                      :requesting="draft.requesting.value === 'domain'"
                      :running="lifecycleRunning === 'mssgDomain'"
                      :progress="mssgJobProgressText(view.job)"
                      :reset-token="draft.resetToken.value"
                      @connect="onDomain('connect', $event)"
                      @check="onDomain('check')"
                      @disconnect="onDomain('disconnect')"
                    />
                  </template>
                  <template #lifecycle>
                    <MssgEditorLifecycleActions
                      :duplicate-reason="lifecycleBlocked"
                      :delete-reason="deleteBlocked"
                      :running-type="lifecycleRunning"
                      :progress="mssgJobProgressText(view.job)"
                      @duplicate="duplicateOpen = true"
                      @delete="openDelete"
                    />
                  </template>
                </MssgEditorSettingsStep>
                <MssgEditorPagesStep
                  v-else-if="step === 2"
                  v-model:page="selectedPageId"
                  :site-id="view.id"
                  :site="draft.localSite.value"
                  :live="view.live"
                  :ops="draft.ops.value"
                  :read-only="draft.readOnly.value"
                  :errors="step2Errors"
                  :reset-token="draft.resetToken.value"
                  :start-kind="startKind"
                  :conflicts="view.conflict?.items ?? []"
                  @page-update="draft.updatePage"
                  @block-update="draft.updateBlock"
                  @ops="draft.editOps"
                  @site-update="draft.updateSite"
                  @start-kind-handled="startKind = null"
                />
                <MssgEditorLookStep
                  v-else-if="step === 3"
                  v-model:page="selectedPageId"
                  :site-id="view.id"
                  :site="draft.localSite.value"
                  :ops="draft.ops.value"
                  :read-only="draft.readOnly.value"
                  :errors="step3Errors"
                  :reset-token="draft.resetToken.value"
                  @page-update="draft.updatePage"
                />
                <MssgEditorSeoStep
                  v-else-if="step === 4"
                  :site-id="view.id"
                  :site="draft.localSite.value"
                  :read-only="draft.readOnly.value"
                  :errors="step4Errors"
                  :reset-token="draft.resetToken.value"
                  @update="draft.updateSite"
                />
                <MssgEditorStoreStep
                  v-else
                  :site-id="view.id"
                  :store="store"
                  :ops="draft.ops.value"
                  :read-only="draft.readOnly.value"
                  :errors="step5Errors"
                  :reset-token="draft.resetToken.value"
                  :read-blocked-reason="storeReadBlocked"
                  :reading="storeReading"
                  :read-progress="mssgJobProgressText(view.job)"
                  :read-error="storeReadError"
                  :stale="storeStale"
                  :add-form-disabled="addFormDisabled"
                  @ops="draft.editOps"
                  @read-store="onReadStore"
                  @add-form="onAddForm"
                />
              </div>
              <div class="mt-5 flex items-center justify-between gap-3 border-t border-default px-4 py-3">
                <div>
                  <UButton
                    v-if="step > 1"
                    label="ย้อนกลับ"
                    color="neutral"
                    variant="outline"
                    data-testid="me-prev"
                    @click="goStep(step - 1)"
                  />
                </div>
                <UButton
                  v-if="step < 5"
                  label="ถัดไป"
                  color="primary"
                  variant="soft"
                  data-testid="me-next"
                  @click="goStep(step + 1)"
                />
                <UButton
                  v-else
                  label="บันทึก"
                  color="primary"
                  :disabled="!!saveBlockedReason || draft.requesting.value !== null"
                  :title="saveBlockedReason ?? undefined"
                  data-testid="me-next-save"
                  @click="onSave"
                />
              </div>
            </section>

            <div class="min-w-0 flex-[1_1_300px] lg:sticky lg:top-0">
              <MssgEditorPreview
                :site="draft.localSite.value"
                :url="resultUrl"
                :site-id="view.id"
                :page-id="step === 2 || step === 3 ? selectedPageId : ''"
              />
            </div>
          </div>
        </template>
      </div>

      <MssgEditorConfirmModal
        v-model:open="confirmOpen"
        title="ยืนยันการเปลี่ยนที่ย้อนกลับไม่ได้"
        description="ร่างนี้มีรายการด้านล่าง เมื่อบันทึกแล้วจะเปลี่ยนบน mssg ทันที"
        :items="destructive.map(d => d.label)"
        confirm-label="ยืนยันและบันทึก"
        color="error"
        :busy="draft.requesting.value === 'apply'"
        testid="me-confirm-destructive"
        @confirm="doApply(true)"
      />
      <MssgEditorConfirmModal
        v-model:open="discardOpen"
        title="ทิ้งร่างนี้?"
        description="การแก้ไขทั้งหมดที่ยังไม่ได้บันทึกไปที่ mssg จะหายไป แล้วกลับไปใช้ค่าปัจจุบันบน mssg"
        confirm-label="ทิ้งร่าง"
        color="error"
        :busy="draft.requesting.value === 'discard'"
        testid="me-confirm-discard"
        @confirm="onDiscard"
      />
      <MssgEditorConfirmModal
        v-model:open="duplicateOpen"
        :title="MSSG_LIFECYCLE_TEXT.duplicateConfirmTitle"
        :description="MSSG_LIFECYCLE_TEXT.duplicateConfirm(view?.live?.name ?? view?.name ?? '')"
        confirm-label="ทำสำเนา"
        color="primary"
        :busy="draft.requesting.value === 'duplicate'"
        testid="me-duplicate-confirm"
        @confirm="onDuplicateConfirm"
      />
      <MssgEditorDeleteSiteModal
        v-model:open="deleteOpen"
        :site-name="view?.live?.name ?? view?.name ?? ''"
        :busy="draft.requesting.value === 'delete'"
        :error="deleteError"
        @confirm="onDeleteConfirm"
      />
      <MssgPagesConnectModal
        v-model:open="reloginOpen"
        :account="account"
        relogin
        workspace-id=""
        :poll-timed-out="!!account && accountPoll.hasTimedOut(account.id)"
        @requested="onReloginRequested"
        @renamed="account = $event"
      />
    </template>
  </UDashboardPanel>
</template>
