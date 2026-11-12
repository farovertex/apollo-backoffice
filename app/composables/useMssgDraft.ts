/**
 * FEAT-101 (spec D4, D12, AC-9, AC-11..19; api-contract.md v1 §2–§3) — the draft model of the mssg site editor.
 *
 * The BO owns the op list of the draft: an edit changes `ops` locally (`updateSite()` in B1; `setOps()` / `pushOp()`
 * for the page / block / product ops of B2–B4), bumps a local version and schedules **one** debounced
 * `PUT /mssg-sites/:id/draft { rev, ops }` (≤ 1 s after the last change). Never two PUTs at a time: an edit made while
 * one is in flight is sent right after it with the new `rev`. The form shows `localSite` = the server's `preview`
 * overlaid with the local site fields, so typing is instant and survives the round trip.
 *
 * Answers: 200 → new view (`draft.rev` + 1). 400 → field errors (`ops.<n>.fields.<path>`) for the steps, no retry
 * until the next edit. 409 `draftChanged` → the view is re-read, the local ops are replaced by the server's and the
 * user is told. 409 `jobInProgress` / `siteGone` / `notConnected` → re-read, read-only with the reason. 404 → "ไม่พบ".
 *
 * Apply (`apply()`): the pending edit is flushed first, then `POST …/apply { rev, confirmDestructive? }`; the 202 view
 * carries the `mssgApply` job, which is followed with `useMssgPoll` (2 s, 15 min cap, stopped on leave). While the job
 * is open the draft is read-only (D12); its end is handed to `onJobEnd` (ok / conflict / validation / partial / …).
 * Every request goes through `useApi()` with `retry: 0`.
 *
 * B2 (M2): `localSite` = the server's `preview` with the not-yet-saved ops laid over it (`mssgLocalPreview`, the client
 * copy of "base + ops"), so page / block edits show at once in the step sheet and the mobile preview. Page / block
 * edits fold through `updatePage()` / `updateBlock()` (one op per object, edits of an object created in the draft go
 * into its create op). Contract v1.1: the account's job of any type (`view.account.job`) is followed too — the site
 * view is re-read every 2 s while it is open (AC-19 busy state) without touching local edits; only the end of the
 * site's own job (`mssgApply` …) is handed to `onJobEnd`.
 */
import type {
  MssgApplyBody,
  MssgDraftPutBody,
  MssgOp,
  MssgOpPageUpdate,
  MssgOpSiteUpdate,
  MssgResolveBody,
  MssgSiteProjection,
  MssgSiteUpdateFields,
  MssgSiteView
} from '#shared/types/mssg-sites'
import type { MssgFieldError } from '~/utils/mssg-sites'

export type MssgDraftLoadState = 'loading' | 'ready' | 'notFound' | 'error'

export interface MssgDraftOptions {
  /** the followed job reached a terminal state (the page shows the outcome) */
  onJobEnd?: (view: MssgSiteView) => void
  /** the 15 min follow-up gave up */
  onPollTimeout?: () => void
  /** v1.1: a job of the account (not this site's own) ended — the page may refresh account data */
  onAccountJobEnd?: (view: MssgSiteView) => void
}

export interface MssgRequestResult {
  ok: boolean
  status?: number
  reason?: string
  message?: string
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v)) as T
}

function leafPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v as Record<string, unknown>, p))
    else out.push(p)
  }
  return out
}

export function useMssgDraft(siteId: Ref<string>, options: MssgDraftOptions = {}) {
  const api = useApi()
  const toast = useToast()

  const view = ref<MssgSiteView | null>(null)
  const loadState = ref<MssgDraftLoadState>('loading')
  const loadError = ref<string | null>(null)
  const loading = ref(false)

  /** the client's op list = what the draft should be */
  const ops = ref<MssgOp[]>([])
  /** bumped on every local edit; `savedVersion` catches up when a PUT of that version answered 200 */
  const localVersion = ref(0)
  const savedVersion = ref(0)
  const saving = ref(false)
  const saveError = ref<string | null>(null)
  /** errors of the last PUT (400 `validation`) */
  const putErrors = ref<MssgFieldError[]>([])
  /** apply errors the user edited since (hidden, keyed by `errKey`) — reset per apply job */
  const dismissedApplyPaths = ref<string[]>([])
  /** bumped whenever `ops` is replaced from the server (load, reload, discard, resolve, job end) — forms re-init */
  const resetToken = ref(0)
  const requesting = ref<null | 'apply' | 'discard' | 'resolve' | 'storeRead'>(null)

  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null
  let loadSeq = 0
  /** the site's own job is being followed (its end goes to `onJobEnd`; an account-only job does not) */
  let ownJobFollowed = false

  // ── derived ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const jobOpen = computed(() => mssgSiteJobOpen(view.value))
  const pending = computed(() => localVersion.value !== savedVersion.value || saving.value)
  /** the draft holds changes not yet written to mssg (server draft or local edits) */
  const dirty = computed(() => ops.value.length > 0 || (view.value?.draft?.ops.length ?? 0) > 0)

  /** server preview + the local ops it has not seen yet (instant form / preview values) */
  const localSite = computed<MssgSiteProjection | null>(() => {
    const v = view.value
    if (!v) return null
    return mssgLocalPreview(v.preview ?? v.live, v.draft?.ops ?? [], v.live, ops.value)
  })
  /** v1.1: a job of the account is open (any type, also another site's) — "บันทึก" waits (AC-19) */
  const accountJobOpen = computed(() => mssgJobIsOpen(view.value?.account?.job))

  const readOnlyReason = computed<string | null>(() => {
    const v = view.value
    if (!v) return null
    if (v.gone) return MSSG_EDITOR_TEXT.gone
    if (jobOpen.value) return `${mssgOwnJobText(v.job)} แก้ร่างได้อีกครั้งเมื่อเสร็จ`
    if (v.account?.status && v.account.status !== 'connected') return MSSG_EDITOR_TEXT.notConnected
    return null
  })
  const readOnly = computed(() => !!readOnlyReason.value || requesting.value !== null)

  const applyErrorsAll = computed<MssgFieldError[]>(() => {
    const la = view.value?.lastApply
    if (!la?.error || la.error.code !== 'mssgValidation' || !view.value?.draft) return []
    return mssgApplyErrorsToFieldErrors(la.error.fields, ops.value)
  })
  const applyErrors = computed<MssgFieldError[]>(() => applyErrorsAll.value.filter(e => !dismissedApplyPaths.value.includes(errKey(e))))
  const fieldErrors = computed<MssgFieldError[]>(() => [...putErrors.value, ...applyErrors.value])

  watch(() => view.value?.lastApply?.jobId, () => {
    dismissedApplyPaths.value = []
  })

  // ── view ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  function takeServerOps(v: MssgSiteView) {
    ops.value = clone(v.draft?.ops ?? [])
    savedVersion.value = localVersion.value
    putErrors.value = []
    saveError.value = null
    resetToken.value++
  }

  function setView(v: MssgSiteView, replaceOps: boolean) {
    view.value = v
    if (replaceOps) takeServerOps(v)
    if (mssgSiteJobOpen(v)) ownJobFollowed = true
    if (mssgSiteJobOpen(v) || mssgJobIsOpen(v.account?.job)) poll.follow(v.id)
  }

  /** a poll answer while only the account's job runs: keep local edits, take the server's draft only when it moved */
  function takeQuiet(v: MssgSiteView) {
    const cur = view.value
    const sameRev = (v.draft?.rev ?? null) === (cur?.draft?.rev ?? null)
    if (sameRev) view.value = v
    else if (!pending.value && !inflight) setView(v, true)
    // else: a PUT of ours is on its way; its answer (or its 409 `draftChanged`) brings the newer view
  }

  async function load(opts: { replaceOps?: boolean } = {}) {
    const id = siteId.value
    if (!id) return
    const s = ++loadSeq
    loading.value = true
    try {
      const v = await api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(id)}`, { retry: 0 })
      if (s !== loadSeq) return
      setView(v, opts.replaceOps ?? true)
      loadState.value = 'ready'
      loadError.value = null
    } catch (e) {
      if (s !== loadSeq) return
      const f = mssgFailure(e, MSSG_EDITOR_TEXT.loadFailed)
      if (f.status === 404) {
        loadState.value = 'notFound'
        view.value = null
      } else if (!view.value) {
        loadState.value = 'error'
        loadError.value = f.status === 403 ? f.message : (f.message === 'ไม่พบบัญชีหรือพื้นที่นี้' ? MSSG_EDITOR_TEXT.loadFailed : f.message)
      } else {
        toast.add({ title: MSSG_EDITOR_TEXT.loadFailed, description: f.message, color: 'error' })
      }
    } finally {
      if (s === loadSeq) loading.value = false
    }
  }

  // ── job follow-up ─────────────────────────────────────────────────────────────────────────────────────────────────
  const poll = useMssgPoll<MssgSiteView>({
    read: id => api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(id)}`, { retry: 0 }),
    needsPoll: v => mssgSiteJobOpen(v) || mssgJobIsOpen(v.account?.job),
    // the draft is frozen while the site's own job is open (D12) — the server's ops are the truth
    onUpdate: (v) => {
      if (mssgSiteJobOpen(v) || ownJobFollowed) setView(v, true)
      else takeQuiet(v)
    },
    onEnd: (v) => {
      if (ownJobFollowed) {
        ownJobFollowed = false
        options.onJobEnd?.(v)
      } else {
        options.onAccountJobEnd?.(v)
      }
    },
    onGone: () => {
      loadState.value = 'notFound'
      view.value = null
    },
    onTimeout: () => options.onPollTimeout?.()
  })
  const polling = computed(() => poll.polling.value.length > 0)
  const pollTimedOut = computed(() => poll.timedOut.value.length > 0)

  // ── edits ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  function errKey(e: MssgFieldError): string {
    return `${e.target.pageId ?? ''}|${e.target.blockId ?? ''}|${e.path}`
  }

  function under(field: string, fields: string[]): boolean {
    return fields.some(f => field === f || field.startsWith(`${f}.`) || f.startsWith(`${field}.`))
  }

  /** the errors an edit answers are hidden right away (server errors return with the next 400 / apply) */
  function clearErrors(pred: (e: MssgFieldError) => boolean) {
    putErrors.value = putErrors.value.filter(e => !pred(e))
    const keys = applyErrorsAll.value.filter(pred).map(errKey)
    if (keys.length) dismissedApplyPaths.value = [...new Set([...dismissedApplyPaths.value, ...keys])]
  }

  function touch(paths: string[] = []) {
    localVersion.value++
    if (paths.length) clearErrors(e => !e.target.pageId && !e.target.blockId && under(e.path, paths))
    schedule()
  }

  /** fold a site-settings change into the draft's (last) `site.update` op */
  function updateSite(patch: MssgSiteUpdateFields) {
    if (readOnly.value) return
    const next = ops.value.slice()
    let i = -1
    for (let k = next.length - 1; k >= 0; k--) {
      if (next[k]!.op === 'site.update') {
        i = k
        break
      }
    }
    if (i === -1) {
      next.push({ op: 'site.update', fields: clone(patch) })
    } else {
      const op = next[i] as MssgOpSiteUpdate
      next[i] = { op: 'site.update', fields: mssgMergeFields(op.fields as Record<string, unknown>, clone(patch) as Record<string, unknown>) as MssgSiteUpdateFields }
    }
    ops.value = next
    touch(leafPaths(patch as Record<string, unknown>))
  }

  /** B2–B4: replace the op list (e.g. add a page / block / product op); `paths` clears their field errors */
  function setOps(next: MssgOp[], paths: string[] = []) {
    if (readOnly.value) return
    ops.value = next
    touch(paths)
  }

  function pushOp(op: MssgOp, paths: string[] = []) {
    setOps([...ops.value, op], paths)
  }

  /** B2: a page edit (folded, see `mssgFoldPageUpdate`); clears the errors of those page fields */
  function updatePage(pageId: string, fields: MssgOpPageUpdate['fields']) {
    if (readOnly.value) return
    ops.value = mssgFoldPageUpdate(ops.value, pageId, fields)
    const touched = leafPaths(fields as Record<string, unknown>)
    clearErrors(e => e.target.pageId === pageId && !e.target.blockId && under(e.target.field, touched))
    touch()
  }

  /** B2: a block edit / hide / show (folded, see `mssgFoldBlockUpdate`); clears the errors of those block fields */
  function updateBlock(pageId: string, blockId: string, patch: { fields?: Record<string, unknown>, enabled?: boolean }) {
    if (readOnly.value) return
    ops.value = mssgFoldBlockUpdate(ops.value, pageId, blockId, patch)
    const touched = [...Object.keys(patch.fields ?? {}), ...(patch.enabled === undefined ? [] : ['enabled'])]
    clearErrors(e => e.target.blockId === blockId && (e.target.field === '' || under(e.target.field, touched)))
    touch()
  }

  /** B2: replace the op list after a structural change (add / clone / move / delete of a page or block) */
  function editOps(next: MssgOp[], clear?: (e: MssgFieldError) => boolean) {
    if (readOnly.value) return
    ops.value = next
    if (clear) clearErrors(clear)
    touch()
  }

  // ── autosave ──────────────────────────────────────────────────────────────────────────────────────────────────────
  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void save()
    }, MSSG_DRAFT_DEBOUNCE_MS)
  }

  async function handleSaveFailure(e: unknown) {
    const f = mssgFailure(e, MSSG_EDITOR_TEXT.draftSaveFailed)
    if (f.status === 400 && f.body?.issues) {
      putErrors.value = mssgIssuesToFieldErrors(f.body.issues, ops.value)
      saveError.value = 'บางช่องยังไม่ถูกต้อง ร่างล่าสุดยังไม่ถูกบันทึก'
      return
    }
    if (f.status === 409) {
      const reason = f.body?.reason
      toast.add({
        title: reason === 'draftChanged' ? 'ร่างถูกแก้จากที่อื่น' : 'บันทึกร่างไม่ได้',
        description: f.message,
        color: 'warning'
      })
      // the state the edit was based on is stale by definition — re-read and take the server's draft
      await load({ replaceOps: true })
      return
    }
    if (f.status === 404) {
      loadState.value = 'notFound'
      view.value = null
      return
    }
    saveError.value = f.message
  }

  async function save(): Promise<void> {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (inflight) await inflight
    if (localVersion.value === savedVersion.value || !view.value || readOnly.value) return
    const sent = localVersion.value
    const body: MssgDraftPutBody = { rev: view.value.draft?.rev ?? null, ops: clone(ops.value) }
    saving.value = true
    saveError.value = null
    let failed = false
    inflight = (async () => {
      try {
        const v = await api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(view.value!.id)}/draft`, { method: 'PUT', body, retry: 0 })
        savedVersion.value = sent
        putErrors.value = []
        view.value = v
      } catch (e) {
        failed = true
        await handleSaveFailure(e)
      } finally {
        saving.value = false
      }
    })()
    try {
      await inflight
    } finally {
      inflight = null
    }
    // edits made while the PUT was in flight go out right after it (never after a failure: the next edit retries)
    if (!failed && localVersion.value !== savedVersion.value) schedule()
  }

  /** send a pending edit now and wait; `true` when the server holds the local ops */
  async function flush(): Promise<boolean> {
    await save()
    return localVersion.value === savedVersion.value && !saveError.value && putErrors.value.length === 0
  }

  // ── discard / resolve / apply ─────────────────────────────────────────────────────────────────────────────────────
  async function request(kind: 'discard' | 'resolve' | 'apply' | 'storeRead', run: () => Promise<MssgSiteView>, fallback: string): Promise<MssgRequestResult> {
    requesting.value = kind
    try {
      const v = await run()
      setView(v, true)
      return { ok: true }
    } catch (e) {
      const f = mssgFailure(e, fallback)
      if (f.status === 404) {
        loadState.value = 'notFound'
        view.value = null
      }
      return { ok: false, status: f.status, reason: f.body?.reason, message: f.message }
    } finally {
      requesting.value = null
    }
  }

  async function discard(): Promise<MssgRequestResult> {
    if (timer) clearTimeout(timer)
    timer = null
    if (inflight) await inflight
    const id = view.value?.id
    if (!id) return { ok: false }
    const res = await request('discard', () => api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(id)}/draft`, { method: 'DELETE', retry: 0 }), 'ทิ้งร่างไม่สำเร็จ')
    if (!res.ok && res.status === 409) await load({ replaceOps: true })
    return res
  }

  async function resolve(take: MssgResolveBody['take']): Promise<MssgRequestResult> {
    const id = view.value?.id
    if (!id) return { ok: false }
    if (!(await flush())) return { ok: false, message: saveError.value ?? MSSG_EDITOR_TEXT.draftSaveFailed }
    const body: MssgResolveBody = { take }
    const res = await request('resolve', () => api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(id)}/draft/resolve`, { method: 'POST', body, retry: 0 }), 'เลือกค่าไม่สำเร็จ')
    if (!res.ok && res.status === 409) await load({ replaceOps: true })
    return res
  }

  async function apply(confirmDestructive: boolean): Promise<MssgRequestResult> {
    if (!(await flush())) return { ok: false, message: saveError.value ?? 'ร่างล่าสุดยังไม่ถูกบันทึก แก้ช่องที่ผิดก่อนแล้วลองใหม่' }
    const v = view.value
    if (!v?.draft) return { ok: false, reason: 'noDraft', message: MSSG_CONFLICT_TEXT.noDraft }
    const body: MssgApplyBody = confirmDestructive ? { rev: v.draft.rev, confirmDestructive: true } : { rev: v.draft.rev }
    const res = await request('apply', () => api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(v.id)}/apply`, { method: 'POST', body, retry: 0 }), 'บันทึกไปที่ mssg ไม่สำเร็จ')
    // the state the button was based on is stale (another job, a changed draft, a pending conflict) — re-read
    if (!res.ok && res.status === 409 && res.reason !== 'confirmRequired') await load({ replaceOps: true })
    return res
  }

  /**
   * M4: "ดึงข้อมูลร้านค้าใหม่" → `POST …/store/read` → 202 view with the `mssgStoreRead` job (followed like an apply, the
   * draft is read-only until it ends). A pending edit is sent first so the 202 view's draft is the one we hold.
   */
  async function readStore(): Promise<MssgRequestResult> {
    const id = view.value?.id
    if (!id) return { ok: false }
    if (!(await flush())) return { ok: false, message: saveError.value ?? 'ร่างล่าสุดยังไม่ถูกบันทึก แก้ช่องที่ผิดก่อนแล้วลองใหม่' }
    const res = await request('storeRead', () => api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(id)}/store/read`, { method: 'POST', retry: 0 }), 'ดึงข้อมูลร้านค้าไม่สำเร็จ')
    if (!res.ok && res.status === 409) await load({ replaceOps: true })
    return res
  }

  /** the user asked to read the view again (retry, poll timed out) */
  function reload() {
    poll.resetTimeouts()
    return load({ replaceOps: !pending.value })
  }

  onScopeDispose(() => {
    loadSeq++
    if (timer) clearTimeout(timer)
  })

  return {
    view,
    loadState,
    loadError,
    loading,
    ops,
    localSite,
    accountJobOpen,
    saving,
    saveError,
    pending,
    dirty,
    jobOpen,
    polling,
    pollTimedOut,
    readOnly,
    readOnlyReason,
    requesting,
    fieldErrors,
    resetToken,
    load,
    reload,
    updateSite,
    setOps,
    pushOp,
    updatePage,
    updateBlock,
    editOps,
    flush,
    discard,
    resolve,
    apply,
    readStore
  }
}
