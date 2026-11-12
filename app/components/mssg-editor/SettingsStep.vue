<script setup lang="ts">
/**
 * FEAT-101 (AC-10, design step 1 "Website Settings · ตั้งค่าเว็บ") — name, language, link (subdomain + 5 apex
 * radios + "ลิงก์ที่ได้"), own domain, publish switch, branding switch, duplicate / delete rows.
 *
 * Each control emits a `site.update` patch only when its value passes the contract's client rule (zod, Thai
 * messages, `UForm` validate-on-input); an invalid value stays in the form with its message and is never sent.
 * Server messages (400 of the draft PUT, `mssgValidation` of an apply) come in as `errors` keyed by the form key
 * and are bound to each `UFormField :error` (BUG-007: `setErrors()` is wiped by the validate-on-input debounce).
 * Turning the publish switch off while the site is live asks first (D6) and makes the op destructive (confirmed again
 * on save). Own domain, duplicate and delete are rendered **disabled "เร็ว ๆ นี้"** until B5 — no handler, no request.
 *
 * Test ids: `me-sheet-1`, `me-field-<path>` / `me-field-error-<path>` for `name`, `localization.lang`, `subdomain`,
 * `apexDomain`, `enabled`, `branding`; `me-result-url`, `me-unpublish-note`, `me-domain`, `me-domain-connect`,
 * `me-duplicate`, `me-delete`, `me-confirm-unpublish(-ok|-cancel)`.
 */
import type { Form } from '@nuxt/ui'
import type { MssgApexDomain, MssgSiteLang, MssgSiteProjection, MssgSiteUpdateFields } from '#shared/types/mssg-sites'
import type { MssgSiteSettingsForm } from '~/utils/mssg-sites'

const props = defineProps<{
  site: MssgSiteProjection | null
  /** live `enabled` (unpublish is destructive only while the live site is on) */
  liveEnabled: boolean
  readOnly: boolean
  /** server messages per form key */
  errors: Partial<Record<keyof MssgSiteSettingsForm, string>>
  /** bumped when the draft was replaced from the server — the form re-reads `site` */
  resetToken: number
}>()

const emit = defineEmits<{ update: [patch: MssgSiteUpdateFields] }>()

const state = reactive<MssgSiteSettingsForm>({
  name: '',
  subdomain: '',
  apexDomain: 'mssg.me',
  lang: 'en',
  enabled: true,
  branding: true
})
const form = useTemplateRef<Form<MssgSiteSettingsForm>>('form')

function fromSite() {
  const s = props.site
  if (!s) return
  state.name = s.name ?? ''
  state.subdomain = s.subdomain ?? ''
  state.apexDomain = (MSSG_APEX_DOMAINS as string[]).includes(s.apexDomain) ? s.apexDomain as MssgApexDomain : 'mssg.me'
  state.lang = (s.localization?.lang ?? 'en') as MssgSiteLang
  state.enabled = !!s.enabled
  state.branding = !!s.branding
  form.value?.clear()
}

// first view, and every time the draft is replaced from the server (load, discard, resolve, job end)
watch([() => props.resetToken, () => !!props.site], fromSite, { immediate: true })

function valid<K extends keyof MssgSiteSettingsForm>(key: K, value: unknown): boolean {
  return mssgSiteSettingsSchema.shape[key].safeParse(value).success
}

function onName(v: string) {
  state.name = v
  if (valid('name', v)) emit('update', { name: v.trim() })
}
function onSubdomain(v: string) {
  state.subdomain = v
  if (valid('subdomain', v)) emit('update', { subdomain: v })
}
function onApex(v: string) {
  if (!valid('apexDomain', v)) return
  state.apexDomain = v as MssgApexDomain
  emit('update', { apexDomain: v as MssgApexDomain })
}
function onLang(v: string) {
  if (!valid('lang', v)) return
  state.lang = v as MssgSiteLang
  emit('update', { localization: { lang: v as MssgSiteLang } })
}
function onBranding(v: boolean) {
  state.branding = v
  emit('update', { branding: v })
}

const unpublishOpen = ref(false)
function onEnabled(v: boolean) {
  if (!v && props.liveEnabled && state.enabled) {
    unpublishOpen.value = true
    return
  }
  state.enabled = v
  emit('update', { enabled: v })
}
function confirmUnpublish() {
  unpublishOpen.value = false
  state.enabled = false
  emit('update', { enabled: false })
}

const resultUrl = computed(() => mssgSiteUrl(state.subdomain, state.apexDomain))
const ownDomain = computed(() => props.site?.domain?.name ?? '')
const unpublishPending = computed(() => props.liveEnabled && !state.enabled)
const apexItems = MSSG_APEX_DOMAINS.map(d => ({ label: d, value: d }))
const langItems = MSSG_LANG_OPTIONS.map(o => ({ label: o.label, value: o.value }))
</script>

<template>
  <UForm
    ref="form"
    :schema="mssgSiteSettingsSchema"
    :state="state"
    :validate-on="['input']"
    :disabled="readOnly"
    class="flex flex-col gap-5"
    data-testid="me-sheet-1"
  >
    <p class="text-sm text-muted">
      ทุกอย่างใน Website Settings ของ mssg
    </p>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UFormField
        label="ชื่อเว็บ (ใช้ภายในระบบ)"
        name="name"
        eager-validation
        required
        :error="errors.name || undefined"
        data-testid="me-field-name-field"
      >
        <UInput
          :model-value="state.name"
          class="w-full"
          maxlength="250"
          data-testid="me-field-name"
          @update:model-value="onName(String($event ?? ''))"
        />
        <template #error="{ error }">
          <span v-if="error" data-testid="me-field-error-name">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField
        label="ภาษาของหน้าเว็บ"
        name="lang"
        :error="errors.lang || undefined"
      >
        <USelect
          :model-value="state.lang"
          :items="langItems"
          class="w-full"
          data-testid="me-field-localization.lang"
          @update:model-value="onLang(String($event))"
        />
        <template #error="{ error }">
          <span v-if="error" data-testid="me-field-error-localization.lang">{{ error }}</span>
        </template>
      </UFormField>
    </div>

    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="mb-1.5 text-sm font-medium text-default">
        ลิงก์เว็บ
      </legend>
      <UFormField
        label="ชื่อลิงก์"
        name="subdomain"
        eager-validation
        required
        description="a-z ตัวเล็ก ตัวเลข และขีด (-) · 4–50 ตัวอักษร"
        :error="errors.subdomain || undefined"
      >
        <UInput
          :model-value="state.subdomain"
          class="w-full"
          maxlength="50"
          autocomplete="off"
          spellcheck="false"
          data-testid="me-field-subdomain"
          @update:model-value="onSubdomain(String($event ?? ''))"
        />
        <template #error="{ error }">
          <span v-if="error" data-testid="me-field-error-subdomain">{{ error }}</span>
        </template>
      </UFormField>
      <UFormField label="โดเมนหลัก" name="apexDomain" :error="errors.apexDomain || undefined">
        <URadioGroup
          :model-value="state.apexDomain"
          :items="apexItems"
          orientation="horizontal"
          :ui="{ fieldset: 'flex flex-wrap gap-x-4 gap-y-2' }"
          data-testid="me-field-apexDomain"
          @update:model-value="onApex(String($event))"
        />
        <template #error="{ error }">
          <span v-if="error" data-testid="me-field-error-apexDomain">{{ error }}</span>
        </template>
      </UFormField>
      <span class="text-xs break-all text-muted">
        ลิงก์ที่ได้: <span class="text-success" data-testid="me-result-url">{{ resultUrl }}</span>
      </span>
    </fieldset>

    <div class="flex flex-col gap-2" data-testid="me-domain" data-soon="true">
      <span class="text-sm font-medium text-default">โดเมนของคุณเอง (ไม่บังคับ)</span>
      <UInput
        :model-value="ownDomain"
        placeholder="เช่น shop.yourbrand.com"
        class="w-full"
        disabled
        aria-label="โดเมนของคุณเอง"
      />
      <span class="text-xs text-muted">Pro Tip: ใส่โดเมนที่ต้องการเชื่อม ถ้ามีเว็บหลักอยู่แล้วใช้ subdomain ได้ เช่น mssg.example.com · ซื้อโดเมนได้ที่ godaddy.com, namecheap.com, nic.ua หรือผู้ขายโดเมนอื่น</span>
      <UButton
        label="เชื่อมโดเมน (Connect domain)"
        color="primary"
        variant="soft"
        size="sm"
        class="self-start"
        disabled
        :title="MSSG_SOON"
        data-testid="me-domain-connect"
      >
        <template #trailing>
          <span class="text-[10px] text-dimmed">{{ MSSG_SOON }}</span>
        </template>
      </UButton>
    </div>

    <div class="flex flex-col gap-1.5 rounded-lg border border-default bg-elevated/40 px-3.5 py-3">
      <div class="flex items-center justify-between gap-4">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-sm font-medium text-highlighted">สถานะเว็บ (Website status)</span>
          <span class="text-xs text-muted">{{ state.enabled ? 'เผยแพร่' : 'ไม่เผยแพร่' }} · Published / Not published</span>
        </span>
        <USwitch
          :model-value="state.enabled"
          :disabled="readOnly"
          aria-label="เผยแพร่เว็บ"
          data-testid="me-field-enabled"
          @update:model-value="onEnabled(!!$event)"
        />
      </div>
      <span v-if="unpublishPending" class="text-xs text-warning" data-testid="me-unpublish-note">{{ MSSG_EDITOR_TEXT.unpublishNote }}</span>
      <span v-if="errors.enabled" class="text-xs text-error" data-testid="me-field-error-enabled">{{ errors.enabled }}</span>
    </div>

    <div class="flex flex-col gap-1.5 rounded-lg border border-default bg-elevated/40 px-3.5 py-3">
      <div class="flex items-center justify-between gap-4">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-sm font-medium text-highlighted">Mssg.me Branding</span>
          <span class="text-xs break-words text-muted">แสดงปุ่ม "Create free website" ท้ายหน้า · Enabled / Disabled ({{ MSSG_EDITOR_TEXT.brandingNote }})</span>
        </span>
        <USwitch
          :model-value="state.branding"
          :disabled="readOnly"
          aria-label="Mssg.me Branding"
          data-testid="me-field-branding"
          @update:model-value="onBranding(!!$event)"
        />
      </div>
      <span v-if="errors.branding" class="text-xs text-error" data-testid="me-field-error-branding">{{ errors.branding }}</span>
    </div>

    <div class="flex flex-col overflow-hidden rounded-lg border border-default bg-elevated/40">
      <button
        type="button"
        disabled
        :title="MSSG_SOON"
        class="flex min-h-11.5 items-center justify-between gap-3 border-b border-default px-3.5 text-start text-sm text-muted disabled:cursor-not-allowed"
        data-testid="me-duplicate"
        data-soon="true"
      >
        <span class="flex min-w-0 flex-wrap items-center gap-2">
          ทำสำเนาเว็บ (Duplicate website)
          <UBadge
            label="Business"
            color="neutral"
            variant="subtle"
            size="sm"
          />
        </span>
        <span class="shrink-0 text-[10px] text-dimmed">{{ MSSG_SOON }}</span>
      </button>
      <button
        type="button"
        disabled
        :title="MSSG_SOON"
        class="flex min-h-11.5 items-center justify-between gap-3 px-3.5 text-start text-sm text-error/60 disabled:cursor-not-allowed"
        data-testid="me-delete"
        data-soon="true"
      >
        <span class="min-w-0">ลบเว็บ (Delete website)</span>
        <span class="shrink-0 text-[10px] text-dimmed">{{ MSSG_SOON }}</span>
      </button>
    </div>

    <MssgEditorConfirmModal
      v-model:open="unpublishOpen"
      title="ปิดการเผยแพร่เว็บนี้?"
      description="เมื่อบันทึกแล้ว คนทั่วไปจะเปิดเว็บนี้ไม่ได้จนกว่าจะเปิดเผยแพร่อีกครั้ง · ตอนกด &quot;บันทึก&quot; ระบบจะถามยืนยันอีกครั้ง"
      confirm-label="ปิดการเผยแพร่"
      color="warning"
      testid="me-confirm-unpublish"
      @confirm="confirmUnpublish"
    />
  </UForm>
</template>
