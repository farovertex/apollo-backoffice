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
 */
import type {
  MssgApplyBody,
  MssgDraftPutBody,
  MssgOp,
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
  /** apply-error paths the user edited since (hidden) — reset per apply job */
  const dismissedApplyPaths = ref<string[]>([])
  /** bumped whenever `ops` is replaced from the server (load, reload, discard, resolve, job end) — forms re-init */
  const resetToken = ref(0)
  const requesting = ref<null | 'apply' | 'discard' | 'resolve'>(null)

  let timer: ReturnType<typeof setTimeout> | null = null
  let inflight: Promise<void> | null = null
  let loadSeq = 0

  // ── derived ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const jobOpen = computed(() => mssgSiteJobOpen(view.value))
  const pending = computed(() => localVersion.value !== savedVersion.value || saving.value)
  /** the draft holds changes not yet written to mssg (server draft or local edits) */
  const dirty = computed(() => ops.value.length > 0 || (view.value?.draft?.ops.length ?? 0) > 0)

  /** merged fields of every `site.update` op (later wins) */
  const siteFields = computed<MssgSiteUpdateFields>(() => {
    let out: Record<string, unknown> = {}
    for (const op of ops.value) {
      if (op.op === 'site.update') out = mssgMergeFields(out, op.fields as Record<string, unknown>)
    }
    return out as MssgSiteUpdateFields
  })

  /** server preview + local site fields (instant form / preview values) */
  const localSite = computed<MssgSiteProjection | null>(() => {
    const preview = view.value?.preview ?? view.value?.live
    if (!preview) return null
    return mssgMergeFields(preview as unknown as Record<string, unknown>, siteFields.value as Record<string, unknown>) as unknown as MssgSiteProjection
  })

  const readOnlyReason = computed<string | null>(() => {
    const v = view.value
    if (!v) return null
    if (v.gone) return MSSG_EDITOR_TEXT.gone
    if (jobOpen.value) return `${MSSG_EDITOR_TEXT.applying} แก้ร่างได้อีกครั้งเมื่อเสร็จ`
    if (v.account?.status && v.account.status !== 'connected') return MSSG_EDITOR_TEXT.notConnected
    return null
  })
  const readOnly = computed(() => !!readOnlyReason.value || requesting.value !== null)

  const applyErrors = computed<MssgFieldError[]>(() => {
    const la = view.value?.lastApply
    if (!la?.error || la.error.code !== 'mssgValidation' || !view.value?.draft) return []
    return mssgApplyErrorsToFieldErrors(la.error.fields, ops.value)
      .filter(e => !dismissedApplyPaths.value.includes(e.path))
  })
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
    if (mssgSiteJobOpen(v)) poll.follow(v.id)
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
    needsPoll: v => mssgSiteJobOpen(v),
    // the draft is frozen while the job is open (D12) — the server's ops are the truth
    onUpdate: v => setView(v, true),
    onEnd: v => options.onJobEnd?.(v),
    onGone: () => {
      loadState.value = 'notFound'
      view.value = null
    },
    onTimeout: () => options.onPollTimeout?.()
  })
  const polling = computed(() => poll.polling.value.length > 0)
  const pollTimedOut = computed(() => poll.timedOut.value.length > 0)

  // ── edits ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  function touch(paths: string[] = []) {
    localVersion.value++
    if (paths.length) {
      putErrors.value = putErrors.value.filter(e => !paths.some(p => e.path === p || e.path.startsWith(`${p}.`)))
      dismissedApplyPaths.value = [...new Set([...dismissedApplyPaths.value, ...paths])]
    }
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
  async function request(kind: 'discard' | 'resolve' | 'apply', run: () => Promise<MssgSiteView>, fallback: string): Promise<MssgRequestResult> {
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
    siteFields,
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
    flush,
    discard,
    resolve,
    apply
  }
}
