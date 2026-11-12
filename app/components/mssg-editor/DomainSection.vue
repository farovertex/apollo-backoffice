<script setup lang="ts">
/**
 * FEAT-101 M5 (AC-36, AC-37; contract §4.6; design step 1 "โดเมนของคุณเอง (ไม่บังคับ)" + Pro tip + "เชื่อมโดเมน") — own
 * domain of the site: hostname input, connect, state badge (none / pending / active / error), the DNS records mssg asks
 * for, "ตรวจสอบอีกครั้ง", and disconnect after a confirm.
 *
 * Emits only — the page starts the `mssgDomain` job (`PUT …/domain { name }`, `POST …/domain/check`,
 * `DELETE …/domain { confirm: true }`) and follows it. An invalid hostname (client rule `mssgDomainIssue`) is never sent;
 * the same name that is already pending / active is not sent again (message instead). Everything is disabled with the
 * page's reason (`blockedReason`: not connected, a job of the account / site runs, site gone …).
 *
 * Test ids: `me-domain` (`data-state` = none|pending|active|error|"" never read, `data-running`), `me-domain-input`,
 * `me-domain-error`, `me-domain-connect`, `me-domain-tip`, `me-domain-state` (`data-state`), `me-domain-name`,
 * `me-domain-hint`, `me-domain-never`, `me-domain-records` (table) with `me-domain-record` rows (`data-type`),
 * `me-domain-checked-at`, `me-domain-check`, `me-domain-disconnect`, `me-domain-reason`, `me-domain-running`;
 * disconnect confirm = `me-confirm-destructive(-ok|-cancel)`.
 */
import type { MssgSiteDomain } from '#shared/types/mssg-sites'

const props = defineProps<{
  /** `view.domain`: `null` = never read */
  domain: MssgSiteDomain | null
  /** the own domain name the site projection knows (`live.domain.name`), shown while `domain` was never read */
  liveName: string | null
  /** why every control is disabled, or `null` */
  blockedReason: string | null
  /** a domain request is in flight */
  requesting: boolean
  /** the site's `mssgDomain` job is open */
  running: boolean
  /** progress line of that job */
  progress: string
  /** bumped when the view was replaced from the server — the input re-reads the name */
  resetToken: number
}>()

const emit = defineEmits<{
  connect: [name: string]
  check: []
  disconnect: []
}>()

const input = ref('')
const error = ref<string | null>(null)
const disconnectOpen = ref(false)

const currentName = computed(() => props.domain?.name ?? props.liveName ?? null)
const state = computed(() => mssgDomainStateOf(props.domain))
const stateInfo = computed(() => (state.value ? MSSG_DOMAIN_STATE[state.value] : null))
const records = computed(() => props.domain?.records ?? [])
const disabled = computed(() => !!props.blockedReason || props.requesting)

watch([() => props.resetToken, currentName], () => {
  input.value = currentName.value ?? ''
  error.value = null
}, { immediate: true })

function onInput(v: string) {
  input.value = v
  error.value = null
}

function onConnect() {
  if (disabled.value) return
  const issue = mssgDomainIssue(input.value)
  if (issue) {
    error.value = issue
    return
  }
  const name = mssgNormalizeHostname(input.value)
  if (name === currentName.value && (state.value === 'pending' || state.value === 'active')) {
    error.value = MSSG_LIFECYCLE_TEXT.domainSame
    return
  }
  error.value = null
  emit('connect', name)
}

function onDisconnectConfirm() {
  disconnectOpen.value = false
  emit('disconnect')
}
</script>

<template>
  <div
    class="flex flex-col gap-2"
    data-testid="me-domain"
    :data-state="state ?? ''"
    :data-running="running ? 'true' : 'false'"
  >
    <span class="text-sm font-medium text-default">{{ MSSG_LIFECYCLE_TEXT.domainTitle }}</span>
    <div class="flex flex-wrap items-start gap-2">
      <UInput
        :model-value="input"
        placeholder="เช่น shop.yourbrand.com"
        class="min-w-0 flex-[1_1_220px]"
        autocomplete="off"
        spellcheck="false"
        maxlength="253"
        :disabled="disabled"
        :color="error ? 'error' : undefined"
        :highlight="!!error || undefined"
        aria-label="โดเมนของคุณเอง"
        :aria-invalid="!!error"
        data-testid="me-domain-input"
        @update:model-value="onInput(String($event ?? ''))"
        @keydown.enter.prevent="onConnect"
      />
      <UButton
        :label="MSSG_LIFECYCLE_TEXT.domainConnect"
        icon="i-lucide-link"
        color="primary"
        variant="soft"
        size="md"
        :loading="requesting"
        :disabled="disabled"
        :title="blockedReason ?? undefined"
        :data-reason="blockedReason ?? ''"
        data-testid="me-domain-connect"
        @click="onConnect"
      />
    </div>
    <span
      v-if="error"
      class="text-xs text-error"
      role="alert"
      data-testid="me-domain-error"
    >{{ error }}</span>
    <span class="text-xs text-muted" data-testid="me-domain-tip">{{ MSSG_LIFECYCLE_TEXT.domainTip }}</span>
    <span v-if="blockedReason && !running" class="text-xs text-muted" data-testid="me-domain-reason">{{ blockedReason }}</span>

    <div
      v-if="running"
      role="status"
      class="flex items-center gap-2 text-xs text-warning"
      data-testid="me-domain-running"
    >
      <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
      <span class="min-w-0 break-words">{{ progress }}</span>
    </div>

    <div class="flex flex-col gap-2 rounded-lg border border-default bg-elevated/40 px-3.5 py-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-muted">สถานะโดเมน</span>
        <UBadge
          v-if="stateInfo"
          :label="stateInfo.label"
          :color="stateInfo.color"
          variant="subtle"
          size="sm"
          data-testid="me-domain-state"
          :data-state="state"
        />
        <UBadge
          v-else
          label="ยังไม่เคยอ่าน"
          color="neutral"
          variant="outline"
          size="sm"
          data-testid="me-domain-state"
          data-state=""
        />
        <span v-if="currentName" class="min-w-0 text-sm font-medium break-all text-highlighted" data-testid="me-domain-name">{{ currentName }}</span>
      </div>
      <span v-if="!domain" class="text-xs text-muted" data-testid="me-domain-never">{{ MSSG_LIFECYCLE_TEXT.domainNeverRead }}</span>
      <span
        v-else-if="stateInfo?.hint"
        class="text-xs break-words"
        :class="state === 'error' ? 'text-error' : state === 'active' ? 'text-success' : 'text-toned'"
        data-testid="me-domain-hint"
      >{{ stateInfo.hint }}</span>

      <div v-if="records.length" class="max-w-full overflow-x-auto">
        <table class="w-full min-w-0 text-start text-xs" data-testid="me-domain-records">
          <caption class="pb-1 text-start text-muted">
            ค่า DNS ที่ต้องตั้งที่ผู้ขายโดเมน
          </caption>
          <thead>
            <tr class="text-muted">
              <th scope="col" class="py-1 pe-3 text-start font-medium">
                Type
              </th>
              <th scope="col" class="py-1 pe-3 text-start font-medium">
                Host / Name
              </th>
              <th scope="col" class="py-1 text-start font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in records"
              :key="`${i}-${r.type}-${r.host}`"
              class="border-t border-default align-top"
              data-testid="me-domain-record"
              :data-type="r.type"
            >
              <td class="py-1.5 pe-3 font-mono">
                {{ r.type }}
              </td>
              <td class="py-1.5 pe-3 font-mono break-all">
                {{ r.host }}
              </td>
              <td class="py-1.5 font-mono break-all">
                {{ r.value }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span v-if="domain?.checkedAt" class="me-auto text-xs text-muted" data-testid="me-domain-checked-at">ตรวจล่าสุด {{ formatDateTime(domain.checkedAt) }}</span>
        <span v-else class="me-auto" />
        <UButton
          :label="MSSG_LIFECYCLE_TEXT.domainCheck"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="xs"
          :disabled="disabled"
          :title="blockedReason ?? 'อ่านสถานะโดเมนล่าสุดจาก mssg'"
          data-testid="me-domain-check"
          @click="emit('check')"
        />
        <UButton
          v-if="currentName && state !== 'none'"
          :label="MSSG_LIFECYCLE_TEXT.domainDisconnect"
          icon="i-lucide-unlink"
          color="error"
          variant="outline"
          size="xs"
          :disabled="disabled"
          :title="blockedReason ?? undefined"
          data-testid="me-domain-disconnect"
          @click="disconnectOpen = true"
        />
      </div>
    </div>

    <MssgEditorConfirmModal
      v-model:open="disconnectOpen"
      :title="MSSG_LIFECYCLE_TEXT.domainDisconnectTitle"
      :description="MSSG_LIFECYCLE_TEXT.domainDisconnectBody(currentName ?? '')"
      :items="currentName ? [`ยกเลิกการเชื่อมโดเมน ${currentName}`] : []"
      confirm-label="ยกเลิกการเชื่อม"
      color="error"
      testid="me-confirm-destructive"
      @confirm="onDisconnectConfirm"
    />
  </div>
</template>
