<script setup lang="ts">
/**
 * Edit account modal (2026-10-12, human request — functions 3.2 "edit credential"; 2026-10-14 TASK-account-label
 * added the Label field). Opened by the row action **Edit** (`ta-edit`) on /tiktok-accounts. Seven fields are
 * editable — **Label**, **Login email**, **Email password**, **Recovery email**, **TikTok password** and
 * (FEAT-075) the whole **เติมเงินอัตโนมัติ** block, plus (FEAT-076) **Prefix**; the browser profile and every flag stay read-only (the API's
 * `PATCH /tiktok-accounts/:id` body is `.strict()` on those seven keys).
 *
 * History of the auto top-up field: 2026-10-16 moved the FEAT-053 channel switch here from the table's
 * **ช่องทาง auto** column, GOD/Payment only (`canPay` prop).
 * FEAT-075 (api-contract v1 §2/§3, spec "UI behaviour", AC-13…AC-15) — the rule itself moved from the GOD-only
 * system settings onto the account, so this section is now **the** place where auto top-up is configured and is
 * shown to **every** caller of the modal (the `canPay` prop is gone; the API's gate is "GOD or an Admin of the
 * account's workspace", a Payment-only admin gets 403 with its own text). Order: switch `ta-edit-auto-enabled` →
 * channel `ta-edit-auto-channel` → card `ta-edit-auto-card` (card channel only) → `ta-edit-auto-min` /
 * `ta-edit-auto-amount` with the account's currency as suffix. Channel / card / amount are always rendered but
 * **disabled while the switch is off** — their values still travel, the API stores them for later.
 *  - the card list is one `GET /tiktok-accounts/:id/payment-cards` per open (usable = `pending|bound` with an
 *    expiry that is not past, `isAutoTopupCard()`); a failure reads as "this account has no usable card" — the
 *    section keeps working and nothing is shown as an error. Since contract **v1.1 §8** that GET is open to the
 *    account's Admin too (read-only), so a 403/404 now only happens for an admin who may not see the account at
 *    all; a **503** (the server has no `CARD_ENCRYPTION_KEY`) is the one case with its own words: the card radio
 *    is disabled exactly the same way, but `ta-edit-auto-card-none` carries the API's `error` text
 *    (fallback `ช่องทางบัตรปิดอยู่ที่เซิร์ฟเวอร์`) instead of the per-account "no card yet" sentence;
 *  - the minimum hints come from one `GET /topups/options` per open (`useTopupOptions`, silent fallback to the
 *    local table), exactly like the pay popovers;
 *  - `balanceCurrency` null → the two number inputs are disabled, `ta-edit-auto-currency-unknown` explains why and
 *    `ta-edit-auto-balance` posts one `POST /topups/accounts/:id/balance` (disabled without a `bcOrgId`).
 * The block is sent **whole** under `autoTopupConfig` and **only when it differs** from the row's effective
 * config, inside the same single diff PATCH as the other five fields (atomic: a 400/403/409/503 writes nothing,
 * keeps the modal open and shows the API's own text in `ta-edit-error`). `autoTopupChannel` is never sent again.
 *
 * On every open the form is prefilled from the row; both passwords start masked (eye toggles, same as the Add
 * modal) and the modal never puts a secret anywhere but the inputs. Submit sends **only the keys that differ** from
 * the row (`PatchAccountBody`) — nothing changed → the Save button is disabled, no request. `recoveryEmail` is
 * sent as `null` when the user cleared it, and so is `label` (an empty label clears it, matching the Add modal's
 * "omitted/empty → null" rule). 200 → close + toast + `updated` (the page refreshes the list);
 * 409 (login email already in the workspace) / 400 → `UAlert` under the form (`ta-edit-error`), modal stays open.
 * zod mirrors the API: label trimmed ≤ 100, optional; email trim → lowercase → valid ≤ 254; passwords 1..128
 * verbatim (no trim); recovery email optional, non-empty must be a valid email. An old row whose `emailPassword`
 * is null may leave that field empty (the key is simply not sent); a row that has one cannot clear it (the API
 * refuses `''`). The auto block's client zod mirrors §2/§2.3 with the API's own texts and blocks Save **without a
 * request**; the API stays the authority for everything it rejects.
 * BUG-045: `validate-on` is `['input']` only — see AddModal.vue for why `blur`/`change` must not come back.
 * FEAT-076 (spec "UI behaviour", AC-17, api-contract §7) — **Prefix** select (`ta-edit-prefix`): `ไม่มี prefix` +
 * the active prefixes of one `GET /backend/prefixes?status=active` per open + the account's current prefix when it
 * is not among them (archived → suffix ` (เก็บถาวร)`, active but not managed by the caller → ` (ไม่ได้ดูแล)`), so
 * the preselection never renders blank. It is one more field of the diff: untouched → no `prefixId` key;
 * another prefix → `prefixId: <id>`; `ไม่มี prefix` → `prefixId: null`. 403 / 404 of the prefix gate (nothing
 * written, other keys included) → `ta-edit-error`.
 * FEAT-086 (spec "UI behaviour" §2, AC-21, api-contract §4) — block **กฎปิด ad group** (`ta-edit-guard`) right after
 * `ta-edit-auto`: mode radio `ta-edit-guard-mode` (`-inherit` / `-custom` / `-off`) seeded from `row.adGroupGuard`
 * (`accountAdGroupGuard()`, a row without the key = inherit); `inherit` shows `ta-edit-guard-inherited` (the
 * workspace rule from `row.adGroupGuardEffective` when its source is `workspace`, else why there is none);
 * `custom` shows `AdGroupGuardRuleFields` (`ta-edit-guard-*`) in the account currency and is **disabled** while
 * the currency is unknown (`ta-edit-guard-currency-unknown`, the API would answer 409). The block is sent whole
 * under `adGroupGuard` only when `{ mode, rule }` differs from the row (`inherit`/`off` without `rule`), inside the
 * same single diff PATCH; 400/409 land in `ta-edit-error` like the auto top-up block (a 400 path
 * `adGroupGuard.rule.<key>` is also shown under that input).
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PaymentCardView, PaymentCardsResponse } from '#shared/types/payment-cards'
import type { PatchAccountAutoTopupConfig, PatchAccountBody, TikTokAccount } from '#shared/types/tiktok-accounts'
import type { AccountBalanceResponse, TopupChannel } from '#shared/types/topups'
import type { AdGroupGuardMode, AdGroupGuardRule } from '#shared/types/ad-group-guard'
import type { AdGroupGuardDraftErrors, AdGroupGuardRuleDraft } from '~/utils/ad-group-guard'

const props = defineProps<{
  account: TikTokAccount | null
}>()

/** §2/§2.3 texts of the API, copied verbatim (the 400/409 body stays the authority — these only save a round trip) */
const AUTO_NEED_NUMBERS = 'ต้องตั้ง minBalance และ amount ก่อนเปิดใช้งาน'
const AUTO_MIN_MESSAGE = 'minBalance ต้องเป็นจำนวนเต็ม ≥ 0'
const AUTO_AMOUNT_MESSAGE = 'amount ต้องเป็นจำนวนเต็ม ≥ 1'
const AUTO_CHOOSE_CARD = 'เลือกบัตรที่จะใช้'
const AUTO_NO_CARD = 'บัญชีนี้ยังไม่มีบัตรที่ใช้ได้ — กรอกบัตรตอนกดจ่ายเงินครั้งแรกก่อน'
/** contract v1.1 §8 — fallback when the 503 of the cards request carries no `error` text of its own */
const AUTO_CARD_CHANNEL_CLOSED = 'ช่องทางบัตรปิดอยู่ที่เซิร์ฟเวอร์'
const AUTO_CURRENCY_UNKNOWN = 'ยังไม่รู้สกุลเงินของบัญชีนี้ — กด Login/Sync ก่อน'
const AUTO_BALANCE_LABEL = 'ดึงยอดตอนนี้'
const AUTO_BALANCE_READING = 'กำลังอ่าน…'
const AUTO_BALANCE_TOAST = 'กำลังอ่านยอดคงเหลือ…'
const AUTO_SYNC_FIRST = 'กด Sync ก่อน'
/** FEAT-086 — §4.1 409 text, shown before the request instead */
const GUARD_CURRENCY_UNKNOWN = 'ยังไม่รู้สกุลเงินของบัญชีนี้ — กด Sync ก่อน'
const GUARD_MODES: AdGroupGuardMode[] = ['inherit', 'custom', 'off']

const emit = defineEmits<{
  updated: [account: TikTokAccount]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-edit-modal`).
const modalContent = { 'data-testid': 'ta-edit-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

// FEAT-076 — `ไม่มี prefix` (USelectMenu needs a non-null value per item; this one maps to `prefixId: null`)
const NO_PREFIX = '__none__'
const prefixOptions = usePrefixOptions()
const { pending: prefixesPending, error: prefixesError } = prefixOptions

// ── the account's own numbers ────────────────────────────────────────────────────────────────────────────────────────
/** `null` = the account's currency is not known yet (no Sync / no balance read) — every money rule is off then */
const currency = computed(() => props.account?.balanceCurrency || null)

/** FEAT-053/FEAT-075 — one `GET /topups/options` per open; a failure is silent and the local table takes over */
const { options: topupOptions, load: loadOptions, reset: resetOptions } = useTopupOptions()

/**
 * TASK-topup-qr-usd (2026-10-26) — the QR option is closed for a USD account (the auto round would only be skipped
 * by the API with this same reason). FEAT-075: the API **does** refuse `enabled: true` + QR + USD now (§2.3 gate 5),
 * so the reason is both a hint and the pre-selection rule — a USD row opens on the card channel.
 */
const qrBlocked = computed(() => qrChannelBlockedReason(props.account?.balanceCurrency, topupOptions.value))

// ── form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface FormState {
  label: string
  loginEmail: string
  emailPassword: string
  recoveryEmail: string
  password: string
  /** FEAT-075 — the account's own auto top-up rule; read through `accountAutoTopupConfig()`, never from a raw key */
  autoEnabled: boolean
  autoChannel: TopupChannel
  /** `null` = "the usable default at round time" (and always `null` on the QR channel) */
  autoCardId: string | null
  /** text, because an empty input is a value of its own (`null` on the wire) */
  autoMinBalance: string
  autoAmount: string
  /** FEAT-076 — the prefix id, `NO_PREFIX` for none */
  prefixId: string
  /** FEAT-086 — the account's ad group guard layer */
  guardMode: AdGroupGuardMode
  guardDraft: AdGroupGuardRuleDraft
}

function numberText(value: number | null): string {
  return value === null ? '' : String(value)
}

/** what the row holds, normalised the way the API stores it — the submit diffs the form against this */
function stateOf(account: TikTokAccount | null): FormState {
  const auto = accountAutoTopupConfig(account)
  return {
    label: account?.label ?? '',
    loginEmail: account?.loginEmail ?? '',
    emailPassword: account?.emailPassword ?? '',
    recoveryEmail: account?.recoveryEmail ?? '',
    password: account?.password ?? '',
    autoEnabled: auto.enabled,
    // a currency the QR channel refuses (USD) can only ever use the card channel — open on it
    autoChannel: auto.channel === 'qr' && qrBlocked.value ? 'card' : auto.channel,
    autoCardId: auto.cardId,
    autoMinBalance: numberText(auto.minBalance),
    autoAmount: numberText(auto.amount),
    prefixId: account?.prefix?.id ?? NO_PREFIX,
    guardMode: accountAdGroupGuard(account).mode,
    guardDraft: adGroupGuardDraftOf(accountAdGroupGuard(account).rule)
  }
}

const original = ref<FormState>(stateOf(null))
const state = reactive<FormState>(stateOf(null))

// ── the account's usable cards (one GET per open, never an error state) ──────────────────────────────────────────────
const cards = ref<PaymentCardView[]>([])
const cardsPending = ref(false)
/** contract v1.1 §8 — the server's reason why the card channel is closed (503 = no `CARD_ENCRYPTION_KEY`); else null */
const cardsClosed = ref<string | null>(null)
let cardsSession = 0

/** §2.3 gate 6 — only these may be configured; a 403/404/5xx on the request leaves the list empty on purpose */
const usableCards = computed(() => cards.value.filter(card => isAutoTopupCard(card)))
const noUsableCards = computed(() => !cardsPending.value && usableCards.value.length === 0)
/** what `ta-edit-auto-card-none` says: the server's 503 reason wins over the per-account "no card yet" sentence */
const cardNoneText = computed(() => cardsClosed.value ?? AUTO_NO_CARD)

/**
 * what `ta-edit-auto-card` offers: the usable cards, plus the card the row is configured with when that one is no
 * longer usable (so the admin can see what is stored instead of an empty select — the API refuses it at gate 6
 * only when the switch is on).
 */
const cardItems = computed(() => {
  const items = usableCards.value.map(card => ({ label: autoTopupCardLabel(card), value: card.cardId }))
  const stored = state.autoCardId
  if (stored && !items.some(item => item.value === stored)) {
    const configured = accountAutoTopupConfig(props.account).card
    items.push({ label: autoTopupCardLabel(configured?.cardId === stored ? configured : null), value: stored })
  }
  return items
})

/**
 * exactly one usable card ⇒ it is shown as selected and the select is disabled, but the form keeps `cardId: null`
 * (api-contract A3: `null` lets the worker resolve the usable default at round time, and it keeps "nothing changed"
 * really unchanged when the modal is only opened and closed)
 */
const theOnlyCard = computed(() => usableCards.value.length === 1 ? usableCards.value[0] ?? null : null)
const cardSelection = computed<string | undefined>({
  // `undefined` and not `null`: that is what `USelectMenu`'s model accepts for "nothing selected"
  get: () => state.autoCardId ?? theOnlyCard.value?.cardId ?? undefined,
  set: (value) => {
    state.autoCardId = value || null
  }
})

async function loadCards(accountId: string) {
  const session = ++cardsSession
  cardsPending.value = true
  cardsClosed.value = null
  try {
    // retry: 0 — exactly one read per open
    const res = await api<PaymentCardsResponse>(`/tiktok-accounts/${encodeURIComponent(accountId)}/payment-cards`, { retry: 0 })
    if (session !== cardsSession) return
    cards.value = res.cards ?? []
  } catch (e) {
    // 403 (a Payment-less admin without access) / 404 / anything else ⇒ "no usable card", never an error on the form.
    // 503 is different (contract v1.1 §8): the server has no `CARD_ENCRYPTION_KEY`, so the card channel is closed
    // for everybody — the same disabled radio, but with the server's own reason.
    if (session !== cardsSession) return
    cards.value = []
    const err = e as FetchError<Partial<ApiErrorBody>>
    cardsClosed.value = err.status === 503 || err.response?.status === 503
      ? (err.data?.error || AUTO_CARD_CHANNEL_CLOSED)
      : null
  } finally {
    if (session === cardsSession) cardsPending.value = false
  }
}

// ── the amount rules of the account's currency (hints; the API's 400 is the authority) ───────────────────────────────
const qrMinAmount = computed(() => topupQrMinAmount(topupOptions.value, currency.value))
const cardLimit = computed(() => topupCardLimit(currency.value, topupOptions.value))

/** `''` → `null` (not configured), an integer → the number, anything else → `undefined` (a client error) */
function toInt(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isInteger(value) ? value : undefined
}

const schema = z.object({
  label: z.string()
    .trim()
    .max(100, 'Label must be at most 100 characters')
    .optional(),
  loginEmail: z.string({ error: 'Login email is required' })
    .trim()
    .toLowerCase()
    .min(1, 'Login email is required')
    .max(254, 'Login email must be at most 254 characters')
    .pipe(z.email('Enter a valid email address')),
  // may stay empty only while the row has no mailbox password yet (old rows) — checked in superRefine
  emailPassword: z.string()
    .max(128, 'Email password must be at most 128 characters'),
  recoveryEmail: z.string()
    .trim()
    .toLowerCase()
    .optional(),
  password: z.string({ error: 'TikTok password is required' })
    .min(1, 'TikTok password is required')
    .max(128, 'TikTok password must be at most 128 characters'),
  autoEnabled: z.boolean(),
  autoChannel: z.enum(['qr', 'card']),
  autoCardId: z.string().nullable(),
  autoMinBalance: z.string(),
  autoAmount: z.string(),
  prefixId: z.string(),
  guardMode: z.enum(['inherit', 'custom', 'off']),
  guardDraft: z.object({
    minSpend: z.string(),
    maxCpm: z.string(),
    minConversions: z.string(),
    combine: z.enum(['or', 'and'])
  })
}).superRefine((data, ctx) => {
  // ── FEAT-086 · the ad group guard block (contract §1.1/§4.1) — only a custom rule has numbers to check ──
  if (data.guardMode === 'custom' && guardChanged.value) {
    if (!currency.value) {
      ctx.addIssue({ code: 'custom', path: ['guardMode'], message: GUARD_CURRENCY_UNKNOWN })
    } else {
      const parsed = parseAdGroupGuardDraft(data.guardDraft)
      if (!parsed.rule) {
        ctx.addIssue({ code: 'custom', path: ['guardDraft'], message: Object.values(parsed.errors).join(' · ') })
      }
    }
  }
  if (!data.emailPassword && original.value.emailPassword) {
    ctx.addIssue({ code: 'custom', path: ['emailPassword'], message: 'Email password is required' })
  }
  if (data.recoveryEmail && (data.recoveryEmail.length > 254 || !z.email().safeParse(data.recoveryEmail).success)) {
    ctx.addIssue({ code: 'custom', path: ['recoveryEmail'], message: 'Enter a valid recovery email address' })
  }
  // ── FEAT-075 · the auto top-up block (contract §2 zod + §2.3 service gates) ──
  const min = toInt(data.autoMinBalance)
  const amount = toInt(data.autoAmount)
  // the shape of a typed number is checked whatever the switch says — a stored block never holds garbage
  if (min === undefined || (min !== null && min < 0)) {
    ctx.addIssue({ code: 'custom', path: ['autoMinBalance'], message: AUTO_MIN_MESSAGE })
  }
  if (amount === undefined || (amount !== null && amount < 1)) {
    ctx.addIssue({ code: 'custom', path: ['autoAmount'], message: AUTO_AMOUNT_MESSAGE })
  }
  // everything below is a money gate: with the switch off the API skips them too (§2.3 gate 3)
  if (!data.autoEnabled) return
  if (!currency.value) {
    // the API would answer 409 — say it here instead of sending a request that cannot succeed
    ctx.addIssue({ code: 'custom', path: ['autoEnabled'], message: AUTO_CURRENCY_UNKNOWN })
    return
  }
  if (min === null) ctx.addIssue({ code: 'custom', path: ['autoMinBalance'], message: AUTO_NEED_NUMBERS })
  if (amount === null) ctx.addIssue({ code: 'custom', path: ['autoAmount'], message: AUTO_NEED_NUMBERS })
  if (typeof amount === 'number' && amount >= 1) {
    const message = data.autoChannel === 'card'
      ? topupAmountError(amount, { channel: 'card', currency: currency.value, limit: cardLimit.value })
      : topupAmountError(amount, { currency: currency.value, qrMin: qrMinAmount.value })
    if (message) ctx.addIssue({ code: 'custom', path: ['autoAmount'], message })
  }
  // §2.3 gate 6: one usable card may stay implicit, several cards must be chosen
  if (data.autoChannel === 'card' && usableCards.value.length > 1 && !cardSelection.value) {
    ctx.addIssue({ code: 'custom', path: ['autoCardId'], message: AUTO_CHOOSE_CARD })
  }
})

type Schema = z.output<typeof schema>

// one toggle per password field; both start masked on every open
const showEmailPassword = ref(false)
const showPassword = ref(false)
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)
/** FEAT-086 — RuleFields shows every client message once a submit was refused; API 400 issues per input */
const guardShowErrors = ref(false)
const guardServerErrors = ref<AdGroupGuardDraftErrors>({})

/** the block the form would send (`rule` null unless custom + valid) */
function guardNext(data: Pick<FormState, 'guardMode' | 'guardDraft'>): { mode: AdGroupGuardMode, rule: AdGroupGuardRule | null } {
  if (data.guardMode !== 'custom') return { mode: data.guardMode, rule: null }
  return { mode: 'custom', rule: parseAdGroupGuardDraft(data.guardDraft).rule }
}

const guardChanged = computed(() => {
  const current = accountAdGroupGuard(props.account)
  const next = guardNext(state)
  if (next.mode !== current.mode) return true
  if (next.mode !== 'custom') return false
  // an invalid custom draft counts as a change (Save is enabled and zod refuses it with the message)
  return !next.rule || !sameAdGroupGuardRule(next.rule, current.rule)
})

const guardCurrency = computed(() => props.account?.adGroupGuardEffective?.currency ?? currency.value)

/** spec §2 — what `inherit` means for this account */
const guardInheritedText = computed(() => {
  const cur = guardCurrency.value
  if (!cur) return GUARD_CURRENCY_UNKNOWN.split(' — ')[0]
  const effective = props.account?.adGroupGuardEffective
  const savedMode = accountAdGroupGuard(props.account).mode
  if (savedMode !== 'inherit') return `หลังบันทึกจะใช้กฎของ workspace สกุล ${cur} (ถ้ามี)`
  if (effective?.source === 'workspace' && effective.rule) return `ปิด ad group เมื่อ ${formatAdGroupGuardRule(effective.rule, cur)}`
  return `workspace ยังไม่ตั้งกฎสกุล ${cur}`
})

function setGuardMode(mode: AdGroupGuardMode) {
  if (mode === 'custom' && !currency.value) return
  state.guardMode = mode
  guardServerErrors.value = {}
}

/** true while at least one of the seven fields differs from the row (the raw input, before zod normalises it) */
const dirty = computed(() =>
  state.label !== original.value.label
  || state.loginEmail !== original.value.loginEmail
  || state.emailPassword !== original.value.emailPassword
  || state.recoveryEmail !== original.value.recoveryEmail
  || state.password !== original.value.password
  || state.autoEnabled !== original.value.autoEnabled
  || state.autoChannel !== original.value.autoChannel
  || (state.autoCardId ?? '') !== (original.value.autoCardId ?? '')
  || state.autoMinBalance.trim() !== original.value.autoMinBalance
  || state.autoAmount.trim() !== original.value.autoAmount
  || state.prefixId !== original.value.prefixId
  || guardChanged.value
)

interface PrefixItem {
  id: string
  label: string
}

/** `ไม่มี prefix` · the pickable prefixes · the account's current one when it is not pickable (suffixed) */
const prefixItems = computed<PrefixItem[]>(() => {
  const items: PrefixItem[] = [{ id: NO_PREFIX, label: 'ไม่มี prefix' }]
  items.push(...prefixOptions.prefixes.value.map(p => ({ id: p.id, label: prefixLabel(p) })))
  const current = props.account?.prefix ?? null
  if (current && !items.some(i => i.id === current.id)) {
    let suffix = ''
    if (current.status === 'archived') suffix = ` (${PREFIX_STATUS_LABEL.archived})`
    else if (prefixOptions.loaded.value) suffix = ' (ไม่ได้ดูแล)'
    items.push({ id: current.id, label: `${prefixLabel(current)}${suffix}` })
  }
  return items
})

function resetForm() {
  original.value = stateOf(props.account)
  Object.assign(state, stateOf(props.account))
  showEmailPassword.value = false
  showPassword.value = false
  submitting.value = false
  submitError.value = null
  guardShowErrors.value = false
  guardServerErrors.value = {}
  balanceRequested.value = false
  balanceBusy.value = false
}

watch(open, (isOpen) => {
  const account = props.account
  if (isOpen) {
    cards.value = []
    cardsClosed.value = null
    resetForm()
    void prefixOptions.load()
    if (account) {
      // exactly one `GET payment-cards` + one `GET /topups/options` per open
      void loadCards(account.id)
      void loadOptions(account.id)
    }
  } else {
    // nothing of the account's cards or limits survives a closed modal
    cardsSession++
    cards.value = []
    cardsPending.value = false
    cardsClosed.value = null
    resetOptions()
    prefixOptions.reset()
  }
})

// ── unknown currency · "ดึงยอดตอนนี้" (`POST /topups/accounts/:id/balance`) ──────────────────────────────────────────
/** true once this open fired the request: the job runs in the background, the modal has to be reopened to see it */
const balanceRequested = ref(false)
const balanceBusy = ref(false)
/** the API answers 400 "กด Sync ก่อน" without a BC — say it on the button instead of firing that request */
const balanceBlocked = computed(() => props.account?.bcOrgId ? null : AUTO_SYNC_FIRST)

async function onReadBalance() {
  const account = props.account
  if (!account || balanceBusy.value || balanceRequested.value || balanceBlocked.value) return
  balanceBusy.value = true
  submitError.value = null
  try {
    // retry: 0 — exactly one POST per click; an open balance job is reused by the API (`reused: true`)
    await api<AccountBalanceResponse>(`/topups/accounts/${encodeURIComponent(account.id)}/balance`, { method: 'POST', retry: 0 })
    balanceRequested.value = true
    toast.add({ title: AUTO_BALANCE_TOAST, description: account.label ?? account.loginEmail, color: 'info' })
  } catch (e) {
    submitError.value = errorState(e)
  } finally {
    balanceBusy.value = false
  }
}

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function errorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  // FEAT-086 — a 400 on the guard block also goes under its input
  const guardIssues: AdGroupGuardDraftErrors = {}
  for (const issue of err.data?.issues ?? []) {
    const path = String(issue.path ?? '')
    if (!path.startsWith('adGroupGuard')) continue
    const key = path.split('.')[2]
    if (key === 'minSpend' || key === 'maxCpm' || key === 'minConversions') guardIssues[key] = issue.message
    else guardIssues.rule = issue.message
  }
  guardServerErrors.value = guardIssues
  return {
    title: err.data?.error ?? err.message ?? 'Could not save the account',
    description: issues && issues.length ? issues.join(' · ') : undefined
  }
}

/** the auto top-up block as the API stores it (contract §2): always complete, `cardId` null on the QR channel */
function autoBlock(data: Schema): PatchAccountAutoTopupConfig {
  const channel = data.autoChannel
  return {
    enabled: data.autoEnabled,
    channel,
    cardId: channel === 'card' ? (data.autoCardId || null) : null,
    minBalance: toInt(data.autoMinBalance) ?? null,
    amount: toInt(data.autoAmount) ?? null
  }
}

/** only the keys whose normalised value differs from the row; `recoveryEmail`/`label` are `null` when cleared */
function changedBody(data: Schema): PatchAccountBody {
  const body: PatchAccountBody = {}
  const label = data.label ?? ''
  if (label !== original.value.label) body.label = label || null
  if (data.loginEmail !== original.value.loginEmail) body.loginEmail = data.loginEmail
  if (data.emailPassword && data.emailPassword !== original.value.emailPassword) body.emailPassword = data.emailPassword
  const recovery = data.recoveryEmail ?? ''
  if (recovery !== original.value.recoveryEmail) body.recoveryEmail = recovery || null
  if (data.password !== original.value.password) body.password = data.password
  // FEAT-075 — the whole block, and only when it differs from the row's effective config (spec "UI behaviour")
  const next = autoBlock(data)
  const current = accountAutoTopupConfig(props.account)
  const autoChanged = next.enabled !== current.enabled
    || next.channel !== current.channel
    || next.cardId !== current.cardId
    || next.minBalance !== current.minBalance
    || next.amount !== current.amount
  if (autoChanged) body.autoTopupConfig = next
  // FEAT-076 — only when the select changed; `ไม่มี prefix` detaches
  if (data.prefixId !== original.value.prefixId) body.prefixId = data.prefixId === NO_PREFIX ? null : data.prefixId
  // FEAT-086 — the whole block, only when `{ mode, rule }` differs from the row; inherit/off carry no `rule`
  if (guardChanged.value) {
    const next = guardNext(data)
    body.adGroupGuard = next.mode === 'custom' && next.rule ? { mode: 'custom', rule: next.rule } : { mode: next.mode === 'off' ? 'off' : 'inherit' }
  }
  return body
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const account = props.account
  if (!account || submitting.value) return
  const body = changedBody(event.data)
  if (Object.keys(body).length === 0) {
    open.value = false
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    // retry: 0 — exactly one PATCH per click (ofetch would otherwise re-issue it on 5xx)
    const updated = await api<TikTokAccount>(`/tiktok-accounts/${encodeURIComponent(account.id)}`, { method: 'PATCH', body, retry: 0 })
    open.value = false
    toast.add({ title: 'Account updated', description: updated.label ?? updated.loginEmail, color: 'success' })
    emit('updated', updated)
  } catch (e) {
    submitError.value = errorState(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Edit account ${account?.label ?? account?.loginEmail ?? ''}`"
    description="The label, login email, both passwords, the recovery email, the auto top-up rule and the ad group guard can be changed here."
    :dismissible="!submitting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        :validate-on="['input']"
        class="space-y-4"
        @submit="onSubmit"
        @error="guardShowErrors = true"
      >
        <UFormField label="Label" name="label" hint="Shown everywhere instead of the login email">
          <UInput
            v-model="state.label"
            autocomplete="off"
            placeholder="Optional"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-edit-label"
          />
        </UFormField>

        <!-- FEAT-076 — routing only; saved by the same diff PATCH as the rest -->
        <UFormField label="Prefix" name="prefixId">
          <USelectMenu
            v-model="state.prefixId"
            :items="prefixItems"
            value-key="id"
            :search-input="{ placeholder: 'Search prefix' }"
            :loading="prefixesPending"
            :disabled="prefixesPending || submitting"
            icon="i-lucide-tag"
            class="w-full"
            data-testid="ta-edit-prefix"
          />
          <template v-if="prefixesError" #error>
            <span data-testid="ta-edit-prefix-error">{{ prefixesError }}</span>
          </template>
        </UFormField>

        <UFormField label="Login email" name="loginEmail" required>
          <UInput
            v-model="state.loginEmail"
            type="email"
            autocomplete="off"
            placeholder="ads@example.com"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-edit-email"
          />
        </UFormField>

        <UFormField
          label="Email password"
          name="emailPassword"
          :required="!!original.emailPassword"
          :hint="original.emailPassword ? undefined : 'Not set'"
        >
          <UInput
            v-model="state.emailPassword"
            :type="showEmailPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Mailbox password of the login email"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
            :disabled="submitting"
            data-testid="ta-edit-email-password"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showEmailPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showEmailPassword ? 'Hide email password' : 'Show email password'"
                :aria-pressed="showEmailPassword"
                data-testid="ta-edit-email-password-toggle"
                @click="showEmailPassword = !showEmailPassword"
              />
            </template>
          </UInput>
        </UFormField>

        <UFormField label="Recovery email" name="recoveryEmail" hint="Optional">
          <UInput
            v-model="state.recoveryEmail"
            type="email"
            autocomplete="off"
            placeholder="recovery@example.com"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-edit-recovery-email"
          />
          <template #help>
            <span data-testid="ta-edit-recovery-email-helper">{{ RECOVERY_EMAIL_HELP }} Leave empty to clear it.</span>
          </template>
        </UFormField>

        <UFormField label="TikTok password" name="password" required>
          <UInput
            v-model="state.password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="TikTok Ads password"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
            :disabled="submitting"
            data-testid="ta-edit-password"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? 'Hide TikTok password' : 'Show TikTok password'"
                :aria-pressed="showPassword"
                data-testid="ta-edit-password-toggle"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </UFormField>

        <!--
          FEAT-075 — เติมเงินอัตโนมัติ: the account's own rule, shown to every caller of the modal and saved by the
          same single diff PATCH as the rest. Switch → channel → card → ยอดต่ำกว่า / เติมครั้งละ.
        -->
        <div class="space-y-3 rounded-md border border-default p-3" data-testid="ta-edit-auto">
          <p class="text-sm font-medium text-highlighted">
            เติมเงินอัตโนมัติ
          </p>

          <UFormField name="autoEnabled">
            <USwitch
              v-model="state.autoEnabled"
              label="เปิดใช้"
              :disabled="submitting"
              data-testid="ta-edit-auto-enabled"
            />
            <template #help>
              <span data-testid="ta-edit-auto-helper">ระบบเปิดรอบเติมเงินให้บัญชีนี้เองเมื่อยอดคงเหลือต่ำกว่าที่ตั้งไว้</span>
            </template>
          </UFormField>

          <UFormField label="ช่องทาง" name="autoChannel">
            <div
              class="flex items-center gap-1"
              role="radiogroup"
              aria-label="ช่องทางเติมเงินอัตโนมัติ"
              data-testid="ta-edit-auto-channel"
              :data-channel="state.autoChannel"
            >
              <UButton
                :label="TOPUP_CHANNEL_LABEL.qr"
                icon="i-lucide-qr-code"
                :color="state.autoChannel === 'qr' ? 'primary' : 'neutral'"
                :variant="state.autoChannel === 'qr' ? 'solid' : 'outline'"
                size="xs"
                role="radio"
                :aria-checked="state.autoChannel === 'qr'"
                :disabled="submitting || !state.autoEnabled || !!qrBlocked"
                data-testid="ta-edit-auto-channel-qr"
                @click="state.autoChannel = 'qr'"
              />
              <UButton
                :label="TOPUP_CHANNEL_LABEL.card"
                icon="i-lucide-credit-card"
                :color="state.autoChannel === 'card' ? 'primary' : 'neutral'"
                :variant="state.autoChannel === 'card' ? 'solid' : 'outline'"
                size="xs"
                role="radio"
                :aria-checked="state.autoChannel === 'card'"
                :disabled="submitting || !state.autoEnabled || noUsableCards"
                data-testid="ta-edit-auto-channel-card"
                @click="state.autoChannel = 'card'"
              />
            </div>
            <template #help>
              <span v-if="qrBlocked" class="block text-warning" data-testid="ta-edit-auto-channel-qr-reason">{{ qrBlocked }}</span>
              <span v-if="noUsableCards" class="block text-warning" data-testid="ta-edit-auto-card-none">{{ cardNoneText }}</span>
            </template>
          </UFormField>

          <UFormField v-if="state.autoChannel === 'card'" label="บัตร" name="autoCardId">
            <USelectMenu
              v-model="cardSelection"
              :items="cardItems"
              value-key="value"
              placeholder="เลือกบัตรที่จะใช้"
              class="w-full"
              :loading="cardsPending"
              :disabled="submitting || !state.autoEnabled || cardsPending || cardItems.length <= 1"
              data-testid="ta-edit-auto-card"
            />
          </UFormField>

          <div class="grid gap-3 sm:grid-cols-2">
            <UFormField label="ยอดต่ำกว่า" name="autoMinBalance">
              <UInput
                v-model="state.autoMinBalance"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                placeholder="500"
                class="w-full"
                :disabled="submitting || !state.autoEnabled || !currency"
                data-testid="ta-edit-auto-min"
              >
                <template v-if="currency" #trailing>
                  <span class="text-xs text-muted" data-testid="ta-edit-auto-currency" :data-currency="currency">{{ currency }}</span>
                </template>
              </UInput>
            </UFormField>
            <UFormField label="เติมครั้งละ" name="autoAmount">
              <UInput
                v-model="state.autoAmount"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                placeholder="2000"
                class="w-full"
                :disabled="submitting || !state.autoEnabled || !currency"
                data-testid="ta-edit-auto-amount"
              >
                <template v-if="currency" #trailing>
                  <span class="text-xs text-muted">{{ currency }}</span>
                </template>
              </UInput>
            </UFormField>
          </div>

          <div v-if="!currency" class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-warning" data-testid="ta-edit-auto-currency-unknown">{{ AUTO_CURRENCY_UNKNOWN }}</span>
            <UButton
              :label="balanceRequested ? AUTO_BALANCE_READING : AUTO_BALANCE_LABEL"
              icon="i-lucide-rotate-cw"
              color="neutral"
              variant="subtle"
              size="xs"
              :loading="balanceBusy"
              :disabled="submitting || balanceBusy || balanceRequested || !!balanceBlocked"
              :title="balanceBlocked ?? undefined"
              data-testid="ta-edit-auto-balance"
              @click="onReadBalance()"
            />
          </div>
        </div>

        <!-- FEAT-086 — กฎปิด ad group: the account layer (inherit / custom / off), same single diff PATCH -->
        <div
          class="space-y-3 rounded-md border border-default p-3"
          data-testid="ta-edit-guard"
          :data-mode="state.guardMode"
        >
          <p class="text-sm font-medium text-highlighted">
            กฎปิด ad group
          </p>

          <UFormField name="guardMode">
            <div
              class="flex flex-wrap items-center gap-1"
              role="radiogroup"
              aria-label="กฎปิด ad group ของบัญชีนี้"
              data-testid="ta-edit-guard-mode"
              :data-mode="state.guardMode"
            >
              <UButton
                v-for="mode in GUARD_MODES"
                :key="mode"
                :label="AGG_MODE_LABEL[mode]"
                :color="state.guardMode === mode ? 'primary' : 'neutral'"
                :variant="state.guardMode === mode ? 'solid' : 'outline'"
                size="xs"
                role="radio"
                :aria-checked="state.guardMode === mode"
                :disabled="submitting || (mode === 'custom' && !currency)"
                :data-testid="`ta-edit-guard-mode-${mode}`"
                @click="setGuardMode(mode)"
              />
            </div>
          </UFormField>

          <p v-if="!currency" class="text-xs text-warning" data-testid="ta-edit-guard-currency-unknown">
            {{ GUARD_CURRENCY_UNKNOWN }}
          </p>

          <p
            v-if="state.guardMode === 'inherit'"
            class="text-sm text-muted"
            data-testid="ta-edit-guard-inherited"
          >
            {{ guardInheritedText }}
          </p>
          <p v-else-if="state.guardMode === 'off'" class="text-sm text-muted" data-testid="ta-edit-guard-off">
            บัญชีนี้ไม่ใช้กฎปิด ad group (order ยังตั้งทับได้)
          </p>
          <AdGroupGuardRuleFields
            v-else
            v-model="state.guardDraft"
            testid="ta-edit-guard"
            :currency="currency"
            :disabled="submitting"
            :show-errors="guardShowErrors"
            :server-errors="guardServerErrors"
            @edited="guardServerErrors = {}"
          />
        </div>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="ta-edit-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-edit-cancel"
            @click="open = false"
          />
          <UButton
            label="Save"
            icon="i-lucide-save"
            color="primary"
            variant="solid"
            type="submit"
            :disabled="!dirty"
            :loading="submitting"
            data-testid="ta-edit-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
