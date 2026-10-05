<script setup lang="ts">
/**
 * "Top up หลายบัญชี" — account-level (Business Center) top-up for many TikTok accounts at once, one amount for all.
 *
 * Loads `GET /tiktok-accounts` when it opens; only active accounts with a `bcOrgId` (synced at least once) and no
 * account-level round still running can be picked. One `POST /topups/accounts` queues one round + one pay job per
 * account; the answer is per account, so the modal stays open on partial failure and lists the API's own error text
 * next to each account that could not start.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AccountsResponse, TikTokAccount } from '#shared/types/tiktok-accounts'
import type { AccountTopupResponse, AccountTopupResult } from '#shared/types/topups'

const emit = defineEmits<{
  created: [results: AccountTopupResult[]]
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'tp-bulk-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const accounts = ref<TikTokAccount[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)
const selected = ref(new Set<string>())
const search = ref('')
const amount = ref<number | undefined>(undefined)
const touched = ref(false)
const submitting = ref(false)
const serverError = ref<string | null>(null)
const failures = ref<AccountTopupResult[]>([])

function accountName(a: TikTokAccount): string {
  return a.label || a.loginEmail
}

/** why this account cannot be picked; null = it can */
function blockedReason(a: TikTokAccount): string | null {
  if (!a.isActive) return 'บัญชีถูกปิดใช้งาน'
  if (!a.bcOrgId) return 'ยังไม่รู้ BC — กด Sync ก่อน'
  if (a.topup?.active) return 'มีรอบฝากที่ยังไม่จบ'
  return null
}

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const list = [...accounts.value].sort((x, y) => accountName(x).localeCompare(accountName(y)))
  if (!needle) return list
  return list.filter(a =>
    accountName(a).toLowerCase().includes(needle)
    || a.loginEmail.toLowerCase().includes(needle)
    || (a.bcOrgName ?? '').toLowerCase().includes(needle)
  )
})
const pickable = computed(() => visible.value.filter(a => !blockedReason(a)))
const allPicked = computed(() => pickable.value.length > 0 && pickable.value.every(a => selected.value.has(a.id)))

const localError = computed(() => topupAmountError(amount.value))
const amountError = computed(() => serverError.value ?? (touched.value ? localError.value : null))
const canSubmit = computed(() => !submitting.value && selected.value.size > 0 && localError.value === null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    // retry: 0 — one request per open
    const res = await api<AccountsResponse>('/tiktok-accounts', { retry: 0 })
    accounts.value = res.accounts ?? []
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    loadError.value = err.data?.error ?? err.message ?? 'โหลดรายชื่อบัญชีไม่สำเร็จ'
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (!isOpen) return
  selected.value = new Set()
  search.value = ''
  amount.value = undefined
  touched.value = false
  serverError.value = null
  failures.value = []
  void load()
})

function toggle(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleAll() {
  const next = new Set(selected.value)
  if (allPicked.value) for (const a of pickable.value) next.delete(a.id)
  else for (const a of pickable.value) next.add(a.id)
  selected.value = next
}

async function submit() {
  touched.value = true
  serverError.value = null
  if (!canSubmit.value) return
  submitting.value = true
  try {
    // retry: 0 — exactly one batch per click
    const res = await api<AccountTopupResponse>('/topups/accounts', {
      method: 'POST',
      retry: 0,
      body: { tiktokAccountIds: [...selected.value], amount: amount.value }
    })
    const results = res.results ?? []
    const okCount = results.filter(r => r.ok).length
    failures.value = results.filter(r => !r.ok)
    if (okCount > 0) emit('created', results)
    toast.add({
      title: `เข้าคิวแล้ว ${okCount}/${results.length} บัญชี`,
      description: failures.value.length ? `ไม่สำเร็จ ${failures.value.length} บัญชี — ดูเหตุผลในหน้าต่าง` : 'กำลังขอ QR ให้ทุกบัญชี',
      color: failures.value.length ? 'warning' : 'success'
    })
    if (!failures.value.length) open.value = false
    else selected.value = new Set(failures.value.map(f => f.tiktokAccountId))
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'ทำรายการไม่สำเร็จ'
    if ((err.response?.status ?? err.statusCode) === 400) serverError.value = message
    else toast.add({ title: 'สั่ง top up ไม่สำเร็จ', description: message, color: 'error' })
  } finally {
    submitting.value = false
  }
}

const failureById = computed(() => new Map(failures.value.map(f => [f.tiktokAccountId, f.error])))
</script>

<template>
  <UModal
    v-model:open="open"
    title="Top up หลายบัญชี"
    description="ฝากที่หน้า payment ของ Business Center — ยอดเดียวกันทุกบัญชี · หนึ่งบัญชี = หนึ่งรอบในตาราง top-up"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-2xl' }"
    :content="modalContent"
  >
    <template #body>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="flex flex-wrap items-start gap-3">
          <div class="flex w-48 flex-col gap-1">
            <label class="text-xs text-muted" for="tp-bulk-amount-input">จำนวนเงินต่อบัญชี (บาท)</label>
            <UInput
              id="tp-bulk-amount-input"
              v-model.number="amount"
              type="number"
              inputmode="numeric"
              :min="TOPUP_MIN_AMOUNT"
              step="1"
              :placeholder="String(TOPUP_MIN_AMOUNT)"
              data-testid="tp-bulk-amount"
              @blur="touched = true"
            />
            <p v-if="amountError" class="text-xs text-error" data-testid="tp-bulk-amount-error">
              {{ amountError }}
            </p>
          </div>
          <UInput
            v-model="search"
            class="min-w-48 flex-1 self-end"
            icon="i-lucide-search"
            placeholder="ค้นหา label, อีเมล หรือชื่อ BC"
            data-testid="tp-bulk-search"
          />
        </div>

        <UAlert
          v-if="loadError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="โหลดรายชื่อบัญชีไม่สำเร็จ"
          :description="loadError"
          data-testid="tp-bulk-error"
        >
          <template #actions>
            <UButton
              label="ลองอีกครั้ง"
              color="error"
              size="xs"
              :loading="loading"
              @click="load()"
            />
          </template>
        </UAlert>

        <div v-else class="flex flex-col gap-1">
          <div class="flex items-center justify-between text-xs text-muted">
            <UCheckbox
              :model-value="allPicked"
              :disabled="loading || pickable.length === 0"
              :label="`เลือกทั้งหมดที่เลือกได้ (${pickable.length})`"
              data-testid="tp-bulk-all"
              @update:model-value="toggleAll()"
            />
            <span data-testid="tp-bulk-count">เลือก {{ selected.size }} บัญชี</span>
          </div>
          <div class="max-h-80 overflow-y-auto rounded-md border border-default" data-testid="tp-bulk-list">
            <p v-if="loading" class="px-3 py-6 text-center text-sm text-muted">
              กำลังโหลด…
            </p>
            <p v-else-if="visible.length === 0" class="px-3 py-6 text-center text-sm text-muted">
              ไม่พบบัญชี
            </p>
            <label
              v-for="a in visible"
              v-else
              :key="a.id"
              class="flex cursor-pointer items-center gap-3 border-b border-default px-3 py-2 last:border-b-0"
              :class="blockedReason(a) ? 'cursor-not-allowed opacity-60' : 'hover:bg-elevated/50'"
              :data-account-id="a.id"
              data-testid="tp-bulk-row"
            >
              <UCheckbox
                :model-value="selected.has(a.id)"
                :disabled="!!blockedReason(a)"
                @update:model-value="toggle(a.id)"
              />
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate font-medium text-highlighted">{{ accountName(a) }}</span>
                <span class="truncate text-xs text-muted">{{ a.bcOrgName || a.bcOrgId || '—' }}</span>
              </span>
              <span class="text-right text-xs whitespace-nowrap tabular-nums text-muted" data-testid="tp-bulk-balance">
                {{ balanceText(a.balanceAmount, a.balanceCurrency) || '—' }}
              </span>
              <span v-if="failureById.get(a.id)" class="max-w-48 text-xs text-error" data-testid="tp-bulk-row-error">
                {{ failureById.get(a.id) }}
              </span>
              <span v-else-if="blockedReason(a)" class="max-w-48 text-xs text-muted">
                {{ blockedReason(a) }}
              </span>
            </label>
          </div>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="tp-bulk-cancel"
            @click="open = false"
          />
          <UButton
            type="submit"
            :label="`ขอ QR ${selected.size} บัญชี`"
            icon="i-lucide-qr-code"
            color="primary"
            :loading="submitting"
            :disabled="!canSubmit"
            data-testid="tp-bulk-submit"
          />
        </div>
      </form>
    </template>
  </UModal>
</template>
