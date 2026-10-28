<script setup lang="ts">
/**
 * FEAT-077 — link a Telegram group to a prefix (`st-prefix-tg-modal`, `data-id`; spec "UI behaviour", AC-17,
 * api-contract v1 §5 / §10).
 *
 * Opening the modal sends **one** `POST /prefixes/:id/telegram/link` (and one more per Renew / Retry). The answer is
 * a `t.me/<bot>?startgroup=<code>` deep link: the admin opens it, picks a group, and Telegram adds the bot and sends
 * the code itself — the API's listener then binds the group. Meanwhile:
 *   - `st-prefix-tg-countdown` counts down to `expiresAt` (`เหลือ mm:ss`); at 0 → `st-prefix-tg-expired` +
 *     `st-prefix-tg-renew` (a new POST replaces the code) and polling stops;
 *   - `GET /prefixes/:id` is polled every 3 s (`retry: 0`) until `telegram.linked && failedAt === null` → toast
 *     `ผูกกลุ่ม <chatTitle> กับ prefix <code> แล้ว`, `linked` is emitted (the page re-reads its list), the modal closes.
 * A 409 / 503 of the POST shows the API's own text in `st-prefix-tg-error` with a Retry. Closing without a link
 * (`st-prefix-tg-cancel`, Escape, outside click, the X, or the page unmounting) sends one
 * `DELETE /prefixes/:id/telegram/link/pending` so the code dies at once. Every async step is tied to a session
 * counter, so nothing (poll, late POST answer) survives a close or an unmount.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PrefixDetailView, PrefixView } from '#shared/types/prefixes'
import type { TelegramLinkResponse } from '#shared/types/telegram'

const POLL_MS = 3000
const LINK_FALLBACK = 'ขอลิงก์ผูกกลุ่มไม่สำเร็จ'
const STEPS = '1. กดลิงก์ 2. เลือกกลุ่ม 3. Telegram เพิ่มบอทและส่งรหัสให้เอง'

const props = defineProps<{
  prefix: PrefixView | null
}>()

const emit = defineEmits<{
  linked: [prefix: PrefixDetailView]
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()

const modalContent = computed(() => ({
  'data-testid': 'st-prefix-tg-modal',
  'data-id': props.prefix?.id ?? ''
}) as ModalProps['content'])

type LinkState = 'requesting' | 'ready' | 'expired' | 'error'

const state = ref<LinkState>('requesting')
const link = ref<TelegramLinkResponse | null>(null)
const errorText = ref<string | null>(null)

/** bumped on open, close and unmount — any late answer of an older session is dropped */
let session = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
/** a POST was issued in this session and the group is not linked yet → closing cancels the code */
let codePending = false
/** the prefix this session works on (the prop may change under a closing modal) */
let prefixId = ''
let prefixCode = ''

const { now, pause: pauseClock, resume: resumeClock } = useNow({ interval: 1000, controls: true })

const remainingMs = computed(() => {
  if (!link.value) return 0
  const t = new Date(link.value.expiresAt).getTime()
  return Number.isNaN(t) ? 0 : Math.max(0, t - now.value.getTime())
})
const countdown = computed(() => {
  const total = Math.ceil(remainingMs.value / 1000)
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
})

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function schedulePoll(s: number) {
  stopPolling()
  pollTimer = setTimeout(() => void poll(s), POLL_MS)
}

async function poll(s: number) {
  if (s !== session || state.value !== 'ready') return
  try {
    // retry: 0 — one read per tick; a failed tick simply waits for the next one
    const res = await api<PrefixDetailView>(`/prefixes/${encodeURIComponent(prefixId)}`, { retry: 0 })
    if (s !== session || state.value !== 'ready') return
    if (res.telegram?.linked && !res.telegram.failedAt) {
      codePending = false
      toast.add({
        title: `ผูกกลุ่ม ${res.telegram.chatTitle || REPORT_DASH} กับ prefix ${res.code || prefixCode} แล้ว`,
        icon: 'i-lucide-check',
        color: 'success'
      })
      emit('linked', res)
      open.value = false
      return
    }
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    // the prefix is gone for this admin — nothing to wait for any more
    if ((err.response?.status ?? err.statusCode) === 404) {
      state.value = 'error'
      errorText.value = err.data?.error ?? err.message ?? LINK_FALLBACK
      return
    }
  }
  if (s === session && state.value === 'ready') schedulePoll(s)
}

async function requestLink() {
  const s = ++session
  stopPolling()
  state.value = 'requesting'
  link.value = null
  errorText.value = null
  codePending = true
  try {
    // retry: 0 — exactly one POST per open / Renew / Retry
    const res = await api<TelegramLinkResponse>(`/prefixes/${encodeURIComponent(prefixId)}/telegram/link`, { method: 'POST', retry: 0 })
    if (s !== session) return
    link.value = res
    resumeClock()
    const expiresAt = new Date(res.expiresAt).getTime()
    state.value = Number.isFinite(expiresAt) && expiresAt > Date.now() ? 'ready' : 'expired'
    if (state.value === 'ready') schedulePoll(s)
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    state.value = 'error'
    errorText.value = err.data?.error ?? err.message ?? LINK_FALLBACK
  }
}

// the code ran out while the modal was open → stop polling, offer Renew
watch(remainingMs, (ms) => {
  if (state.value === 'ready' && link.value && ms <= 0) {
    state.value = 'expired'
    stopPolling()
  }
})

/** best effort: the code of this session dies now instead of in 15 minutes */
function cancelPending() {
  if (!codePending || !prefixId) return
  codePending = false
  void api(`/prefixes/${encodeURIComponent(prefixId)}/telegram/link/pending`, { method: 'DELETE', retry: 0 }).catch(() => {})
}

function teardown() {
  session++
  stopPolling()
  pauseClock()
  cancelPending()
}

watch(open, (isOpen) => {
  if (isOpen && props.prefix) {
    prefixId = props.prefix.id
    prefixCode = props.prefix.code
    void requestLink()
  } else if (!isOpen) {
    teardown()
  }
}, { immediate: true })

onUnmounted(teardown)

async function copy() {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value.url)
    toast.add({ title: 'คัดลอกลิงก์แล้ว', icon: 'i-lucide-clipboard-check', color: 'success' })
  } catch {
    toast.add({ title: 'คัดลอกไม่สำเร็จ', description: 'เลือกลิงก์ในช่องแล้วคัดลอกเอง', color: 'warning' })
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`ผูกกลุ่ม Telegram · prefix ${prefix?.code ?? ''}`"
    description="QR เติมเงินของบัญชีใต้ prefix นี้จะถูกส่งเข้ากลุ่มที่ผูก"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4" :data-state="state">
        <div v-if="state === 'requesting'" class="flex items-center gap-2 text-sm text-muted" data-testid="st-prefix-tg-pending">
          <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin" />
          กำลังขอลิงก์…
        </div>

        <UAlert
          v-else-if="state === 'error'"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          role="alert"
          data-testid="st-prefix-tg-error"
        >
          <template #description>
            <span class="break-words">{{ errorText ?? LINK_FALLBACK }}</span>
          </template>
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              data-testid="st-prefix-tg-retry"
              @click="requestLink()"
            />
          </template>
        </UAlert>

        <template v-else-if="link">
          <div class="flex flex-col gap-1">
            <label class="text-xs text-muted" for="st-prefix-tg-url-input">ลิงก์เพิ่มบอทเข้ากลุ่ม</label>
            <div class="flex min-w-0 gap-2">
              <UInput
                id="st-prefix-tg-url-input"
                :model-value="link.url"
                readonly
                class="min-w-0 flex-1"
                :ui="{ base: 'font-mono text-xs' }"
                data-testid="st-prefix-tg-url"
                @focus="($event.target as HTMLInputElement | null)?.select()"
              />
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                aria-label="คัดลอกลิงก์"
                :disabled="state === 'expired'"
                data-testid="st-prefix-tg-copy"
                @click="copy()"
              />
            </div>
          </div>

          <UButton
            v-if="state === 'ready'"
            :to="link.url"
            target="_blank"
            rel="noopener noreferrer"
            external
            label="เปิดลิงก์ใน Telegram"
            icon="i-lucide-send"
            color="primary"
            class="w-fit"
            data-testid="st-prefix-tg-open"
          />

          <p class="text-sm break-words text-muted" data-testid="st-prefix-tg-steps">
            {{ STEPS }}
          </p>

          <div v-if="state === 'ready'" class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-loader-circle" class="size-4 animate-spin text-muted" />
            <span class="text-muted">รอ Telegram ส่งรหัส ·</span>
            <span class="font-medium tabular-nums" data-testid="st-prefix-tg-countdown" :data-expires-at="link.expiresAt">เหลือ {{ countdown }}</span>
          </div>

          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-lucide-timer-off"
            title="รหัสหมดอายุแล้ว"
            data-testid="st-prefix-tg-expired"
          >
            <template #actions>
              <UButton
                label="ขอลิงก์ใหม่"
                icon="i-lucide-refresh-cw"
                color="warning"
                variant="solid"
                size="xs"
                data-testid="st-prefix-tg-renew"
                @click="requestLink()"
              />
            </template>
          </UAlert>
        </template>

        <div class="flex justify-end">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            data-testid="st-prefix-tg-cancel"
            @click="open = false"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
