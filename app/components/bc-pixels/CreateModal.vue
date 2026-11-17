<script setup lang="ts">
/**
 * FEAT-102 (spec "UI behaviour → Create modal", AC-22; api-contract.md v1 §3.1–§3.2, §7.4 `bpx-create-*`).
 * Opens with one `GET /bc-pixels/options` (the selectable sites). Choosing a site re-reads
 * `GET /bc-pixels/options?siteId=` → the logins of that site's workspace with their BC orgs, the suggested name,
 * the site's current pixel and `canCreate` / `reason`. The login select lists only those logins; the BC select
 * follows the login (one entry → chosen automatically). The name is prefilled with the suggestion and validated
 * inline (empty / > `nameMax`). A site with a current pixel needs the `replace` checkbox before submit is enabled.
 * Submit → exactly one `POST /bc-pixels` (`retry: 0`) with `{ siteId, tiktokAccountId, bcOrgId, name, replace }`
 * → 202 → the modal closes and emits `created`; the page follows the create job. 409 → the API's `error` verbatim:
 * `nameTaken` under the name field, anything else in `bpx-create-error`; the modal stays open.
 */
import * as z from 'zod'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type {
  PixelCreateAccepted,
  PixelCreateBody,
  PixelOptionAccount,
  PixelOptionSite,
  PixelOptionsSiteResponse,
  PixelOptionsSitesResponse
} from '#shared/types/bc-pixels'

const emit = defineEmits<{
  created: [accepted: PixelCreateAccepted]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless: the testid goes onto the rendered DialogContent through `content`
const modalContent = { 'data-testid': 'bpx-create-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

// ── sites (GET options) ──────────────────────────────────────────────────────────────────────────────────────────────
const sites = ref<PixelOptionSite[]>([])
const sitesPending = ref(false)
const sitesError = ref<string | null>(null)
let sitesSeq = 0

async function loadSites() {
  const s = ++sitesSeq
  sitesPending.value = true
  sitesError.value = null
  try {
    const res = await api<PixelOptionsSitesResponse>('/bc-pixels/options', { retry: 0 })
    if (s !== sitesSeq) return
    sites.value = res.sites ?? []
  } catch (e) {
    if (s !== sitesSeq) return
    sitesError.value = bcPixelFailure(e, 'โหลดรายการเว็บไม่สำเร็จ').message
  } finally {
    if (s === sitesSeq) sitesPending.value = false
  }
}

function siteHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const siteItems = computed(() => sites.value.map(site => ({
  id: site.id,
  label: site.name || siteHost(site.url),
  description: [siteHost(site.url), site.accountLabel].filter(Boolean).join(' · '),
  hasPixel: !!site.currentPixel
})))

// ── chosen site → options?siteId= ────────────────────────────────────────────────────────────────────────────────────
const siteId = ref<string | undefined>(undefined)
const options = ref<PixelOptionsSiteResponse | null>(null)
const optionsPending = ref(false)
const optionsError = ref<string | null>(null)
let optionsSeq = 0

const accountId = ref<string | undefined>(undefined)
const orgId = ref<string | undefined>(undefined)
const replace = ref(false)
const state = reactive<{ name: string }>({ name: '' })
/** set on a 409 `nameTaken` until the name changes */
const serverNameError = ref<string | null>(null)
const submitting = ref(false)
const submitError = ref<string | null>(null)

async function loadOptions(id: string) {
  const s = ++optionsSeq
  optionsPending.value = true
  optionsError.value = null
  options.value = null
  accountId.value = undefined
  orgId.value = undefined
  replace.value = false
  serverNameError.value = null
  submitError.value = null
  try {
    const res = await api<PixelOptionsSiteResponse>('/bc-pixels/options', { retry: 0, query: { siteId: id } })
    if (s !== optionsSeq) return
    options.value = res
    state.name = res.suggestedName ?? ''
    // one login → chosen for the user (its BC follows below)
    const usable = res.accounts.filter(accountUsable)
    if (usable.length === 1) accountId.value = usable[0]!.id
  } catch (e) {
    if (s !== optionsSeq) return
    optionsError.value = bcPixelFailure(e, 'โหลดข้อมูลเว็บไม่สำเร็จ').message
  } finally {
    if (s === optionsSeq) optionsPending.value = false
  }
}

watch(siteId, (id) => {
  if (id) void loadOptions(id)
  else {
    optionsSeq++
    options.value = null
  }
})

function accountUsable(a: PixelOptionAccount): boolean {
  return a.isActive && a.hasProfile && a.orgs.length > 0
}

const accounts = computed<PixelOptionAccount[]>(() => options.value?.accounts ?? [])
const accountItems = computed(() => accounts.value.map(a => ({
  id: a.id,
  label: a.label,
  description: !a.isActive ? 'account ถูกปิดใช้งาน' : !a.hasProfile ? 'ยังไม่มีโปรไฟล์ที่พร้อมใช้' : `${a.orgs.length} Business Center`,
  disabled: !accountUsable(a)
})))
const account = computed(() => accounts.value.find(a => a.id === accountId.value) ?? null)

const orgItems = computed(() => (account.value?.orgs ?? []).map(o => ({
  id: o.orgId,
  label: bcPixelOrgText(o),
  description: `${o.advertiserCount} บัญชีโฆษณา`
})))

// the BC follows the login: reset on change, auto-pick a single org
watch(accountId, () => {
  const orgs = account.value?.orgs ?? []
  orgId.value = orgs.length === 1 ? orgs[0]!.orgId : undefined
})

const nameMax = computed(() => options.value?.nameMax ?? BC_PIXEL_NAME_MAX)
watch(() => state.name, () => {
  serverNameError.value = null
})
/** live inline error (UForm only surfaces schema issues after a submit) */
const nameError = computed<string | undefined>(() => {
  if (serverNameError.value) return serverNameError.value
  if (!options.value) return undefined
  return pixelNameError(state.name, nameMax.value)
})

const schema = computed(() => z.object({
  name: z.string()
    .transform(normalizePixelName)
    .pipe(z.string().min(1, BC_PIXEL_TEXT.nameEmpty).max(nameMax.value, `ชื่อ pixel ยาวได้ไม่เกิน ${nameMax.value} ตัวอักษร`))
}))
type Schema = { name: string }

const currentPixel = computed(() => options.value?.currentPixel ?? null)
/** `canCreate: false` → the reason sentence (a current pixel never sets it; the modal offers `replace`) */
const blockedText = computed<string | null>(() => {
  const o = options.value
  if (!o || o.canCreate) return null
  return bcPixelConflictText(o.reason)
})

const canSubmit = computed(() =>
  !!options.value
  && !blockedText.value
  && !!siteId.value
  && !!accountId.value
  && !!orgId.value
  && !nameError.value
  && (!currentPixel.value || replace.value)
  && !submitting.value
)

function reset() {
  sitesSeq++
  optionsSeq++
  siteId.value = undefined
  options.value = null
  optionsError.value = null
  accountId.value = undefined
  orgId.value = undefined
  replace.value = false
  state.name = ''
  serverNameError.value = null
  submitError.value = null
  submitting.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    reset()
    void loadSites()
  }
}, { immediate: true })

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (!canSubmit.value || !siteId.value || !accountId.value || !orgId.value) return
  submitting.value = true
  submitError.value = null
  const body: PixelCreateBody = {
    siteId: siteId.value,
    tiktokAccountId: accountId.value,
    bcOrgId: orgId.value,
    name: event.data.name,
    replace: !!currentPixel.value && replace.value
  }
  try {
    // retry: 0 — exactly one POST per click (a retry would queue a second create job)
    const res = await api<PixelCreateAccepted>('/bc-pixels', { method: 'POST', retry: 0, body })
    open.value = false
    emit('created', res)
  } catch (e) {
    const f = bcPixelFailure(e, BC_PIXEL_TOAST.createFailed)
    if (f.reason === 'nameTaken') serverNameError.value = f.message
    else submitError.value = f.message
    toast.add({ title: BC_PIXEL_TOAST.createFailed, description: f.message, color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="สร้าง pixel"
    description="สร้าง pixel ใน Business Center ของบัญชี TikTok สำหรับเว็บ mssg หนึ่งเว็บ"
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
      >
        <UAlert
          v-if="sitesError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="sitesError"
          data-testid="bpx-create-error"
        >
          <template #actions>
            <UButton
              label="ลองใหม่"
              color="error"
              variant="solid"
              size="xs"
              @click="loadSites()"
            />
          </template>
        </UAlert>

        <UFormField label="เว็บ" name="siteId" required>
          <USelectMenu
            v-model="siteId"
            :items="siteItems"
            value-key="id"
            :search-input="{ placeholder: 'ค้นหาเว็บ' }"
            :loading="sitesPending"
            :disabled="sitesPending || submitting"
            :placeholder="sitesPending ? 'กำลังโหลด…' : 'เลือกเว็บ'"
            icon="i-lucide-globe"
            class="w-full"
            data-testid="bpx-create-site"
          >
            <template #item-trailing="{ item }">
              <UBadge
                v-if="item.hasPixel"
                color="warning"
                variant="subtle"
                size="sm"
                class="whitespace-nowrap"
              >
                {{ BC_PIXEL_TEXT.hasPixel }}
              </UBadge>
            </template>
          </USelectMenu>
        </UFormField>

        <div v-if="optionsPending" class="space-y-2">
          <USkeleton class="h-8 w-full" />
          <USkeleton class="h-8 w-full" />
        </div>

        <UAlert
          v-else-if="optionsError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="optionsError"
          data-testid="bpx-create-error"
        >
          <template #actions>
            <UButton
              label="ลองใหม่"
              color="error"
              variant="solid"
              size="xs"
              @click="siteId && loadOptions(siteId)"
            />
          </template>
        </UAlert>

        <template v-else-if="options">
          <UAlert
            v-if="blockedText"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="สร้างไม่ได้ตอนนี้"
            :description="blockedText"
            role="alert"
            data-testid="bpx-create-blocked"
            :data-reason="options.reason ?? ''"
          />

          <div
            v-if="currentPixel"
            class="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm"
          >
            <p class="text-highlighted">
              {{ BC_PIXEL_TEXT.hasPixel }}: <span class="font-medium">{{ currentPixel.name }}</span>
              <span class="font-mono text-muted"> (…{{ currentPixel.pixelCodeLast4 }})</span>
            </p>
            <UCheckbox
              v-model="replace"
              :label="BC_PIXEL_TEXT.replace"
              :disabled="submitting"
              data-testid="bpx-create-replace"
            />
          </div>

          <UFormField label="บัญชี TikTok (login)" name="tiktokAccountId" required>
            <USelectMenu
              v-model="accountId"
              :items="accountItems"
              value-key="id"
              :search-input="false"
              :disabled="submitting || !!blockedText || accountItems.length === 0"
              placeholder="เลือกบัญชี"
              icon="i-lucide-user-round"
              class="w-full"
              data-testid="bpx-create-account"
            />
          </UFormField>

          <UFormField label="Business Center" name="bcOrgId" required>
            <USelectMenu
              v-model="orgId"
              :items="orgItems"
              value-key="id"
              :search-input="false"
              :disabled="submitting || !!blockedText || !accountId"
              :placeholder="accountId ? 'เลือก Business Center' : 'เลือกบัญชีก่อน'"
              icon="i-lucide-building-2"
              class="w-full"
              data-testid="bpx-create-org"
            />
          </UFormField>

          <UFormField
            label="ชื่อ pixel"
            name="name"
            required
            :error="nameError"
          >
            <UInput
              v-model="state.name"
              autocomplete="off"
              placeholder="ชื่อ pixel"
              class="w-full"
              :maxlength="nameMax + 20"
              :disabled="submitting || !!blockedText"
              data-testid="bpx-create-name"
            />
            <template #error="{ error }">
              <span data-testid="bpx-create-name-error">{{ error }}</span>
            </template>
          </UFormField>
        </template>

        <p
          class="flex items-start gap-1.5 text-xs text-warning"
          data-testid="bpx-create-warning"
        >
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-3.5 shrink-0" />
          <span>{{ BC_PIXEL_TEXT.createWarning }}</span>
        </p>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError"
          role="alert"
          data-testid="bpx-create-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="bpx-create-cancel"
            @click="open = false"
          />
          <UButton
            label="สร้าง pixel"
            icon="i-lucide-plus"
            color="primary"
            variant="solid"
            type="submit"
            :disabled="!canSubmit"
            :loading="submitting"
            data-testid="bpx-create-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
