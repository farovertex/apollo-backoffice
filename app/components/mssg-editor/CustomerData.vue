<script setup lang="ts">
/**
 * FEAT-101 M4 — Audience and Requests of step 5, **read-only** (D8, AC-32). The API stores the last store read with e-mail
 * addresses and phone numbers already masked (`so***@gmail.com`, `08******12`); the lists show them as received (a value
 * that still looks like a whole contact is masked again, `mssgMaskContact`). ≤ 100 rows per list + the totals.
 *
 * Audience: total + rows; empty state with "+ เพิ่ม block Form" (→ step 2, SubscriptionForm preselected, `addForm`).
 * Requests: tabs New / In progress / Done / Canceled with their counts; empty tab "<tab> · ไม่พบรายการ (Nothing found)".
 * Nothing here is editable and nothing sends a request ("ดูรายชื่อเต็มที่ mssg": the BO has no mssg host to link to).
 *
 * Test ids: `me-audience` (`data-total`), `me-audience-row` (`data-id`), `me-audience-empty`, `me-audience-add-form`,
 * `me-audience-more`, `me-requests` (`data-tab`), `me-requests-tab-<new|inProgress|done|canceled>` (`data-count`,
 * `aria-pressed`), `me-request-row` (`data-id`), `me-requests-empty`, `me-customer-note`.
 */
import type { MssgRequestStatus, MssgStore } from '#shared/types/mssg-sites'

const props = defineProps<{
  store: MssgStore
  /** the "+ เพิ่ม block Form" button is disabled (read-only draft / no page) */
  addFormDisabled: boolean
}>()
const emit = defineEmits<{ addForm: [] }>()

const tab = ref<MssgRequestStatus>('new')
const audienceTotal = computed(() => props.store.audience?.total ?? 0)
const audienceRows = computed(() => (props.store.audience?.rows ?? []).slice(0, MSSG_CUSTOMER_ROWS_MAX))
const rows = computed(() => mssgRequestRows(props.store, tab.value).slice(0, MSSG_CUSTOMER_ROWS_MAX))
const tabLabel = computed(() => MSSG_REQUEST_TABS.find(t => t.key === tab.value)?.label ?? '')

function dateText(iso: string | null | undefined): string {
  return iso ? formatDateTime(iso) : '—'
}
function contact(...parts: (string | null | undefined)[]): string {
  return parts.map(p => mssgMaskContact(p)).filter(Boolean).join(' · ')
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-5">
    <p class="text-xs text-muted" data-testid="me-customer-note">
      ข้อมูลลูกค้าของเว็บนี้ · อีเมลและเบอร์โทรถูกปิดบังบางส่วนก่อนเก็บใน Apollo · ดูรายชื่อเต็มที่ mssg
    </p>

    <section
      class="flex min-w-0 flex-col gap-3 rounded-lg border border-default bg-elevated/40 p-3.5"
      aria-label="ผู้ติดต่อ"
      data-testid="me-audience"
      :data-total="audienceTotal"
    >
      <span class="text-sm font-semibold text-highlighted">ผู้ติดต่อ (Audience) · {{ audienceTotal }}</span>
      <template v-if="!audienceRows.length">
        <p class="rounded-md border border-dashed border-default px-3 py-4 text-center text-sm text-muted" data-testid="me-audience-empty">
          เพิ่ม block "Form" ในเว็บ แล้วรายชื่อผู้ติดต่อจะแสดงที่นี่
        </p>
        <UButton
          label="+ เพิ่ม block Form"
          color="primary"
          variant="soft"
          size="sm"
          class="self-start"
          :disabled="addFormDisabled"
          data-testid="me-audience-add-form"
          @click="emit('addForm')"
        />
      </template>
      <ul v-else class="flex min-w-0 flex-col gap-2">
        <li
          v-for="r in audienceRows"
          :key="r.id"
          class="flex min-w-0 flex-col gap-1 rounded-md border border-default bg-default px-3 py-2 text-sm"
          data-testid="me-audience-row"
          :data-id="r.id"
        >
          <span class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-medium break-words text-highlighted">{{ r.name || '(ไม่มีชื่อ)' }}</span>
            <span class="text-xs text-muted">{{ dateText(r.createdAt) }}</span>
          </span>
          <span v-if="contact(r.email, r.phone)" class="break-all text-toned">{{ contact(r.email, r.phone) }}</span>
          <span
            v-for="(f, i) in r.fields ?? []"
            :key="`${i}-${f.label}`"
            class="text-xs break-words text-muted"
          >{{ f.label }}: {{ mssgMaskContact(f.value) }}</span>
        </li>
      </ul>
      <p v-if="audienceTotal > audienceRows.length && audienceRows.length" class="text-xs text-muted" data-testid="me-audience-more">
        แสดง {{ audienceRows.length }} จาก {{ audienceTotal }} รายการ · ดูรายชื่อเต็มที่ mssg
      </p>
    </section>

    <section
      class="flex min-w-0 flex-col gap-3 rounded-lg border border-default bg-elevated/40 p-3.5"
      aria-label="คำขอ"
      data-testid="me-requests"
      :data-tab="tab"
    >
      <span class="text-sm font-semibold text-highlighted">คำขอ (Requests)</span>
      <div role="group" aria-label="สถานะคำขอ" class="flex flex-wrap gap-2">
        <UButton
          v-for="t in MSSG_REQUEST_TABS"
          :key="t.key"
          :label="`${t.label} · ${mssgRequestCount(store, t.key)}`"
          :color="tab === t.key ? 'primary' : 'neutral'"
          :variant="tab === t.key ? 'subtle' : 'outline'"
          size="sm"
          :aria-pressed="tab === t.key"
          :data-count="mssgRequestCount(store, t.key)"
          :data-testid="`me-requests-tab-${t.key}`"
          @click="tab = t.key"
        />
      </div>
      <p v-if="!rows.length" class="rounded-md border border-dashed border-default px-3 py-4 text-center text-sm text-muted" data-testid="me-requests-empty">
        {{ tabLabel }} · ไม่พบรายการ (Nothing found)
      </p>
      <ul v-else class="flex min-w-0 flex-col gap-2">
        <li
          v-for="r in rows"
          :key="r.id"
          class="flex min-w-0 flex-col gap-1 rounded-md border border-default bg-default px-3 py-2 text-sm"
          data-testid="me-request-row"
          :data-id="r.id"
        >
          <span class="flex flex-wrap items-baseline justify-between gap-x-3">
            <span class="font-medium break-words text-highlighted">{{ r.title || '(ไม่มีหัวข้อ)' }}</span>
            <span class="text-xs text-muted">{{ dateText(r.createdAt) }}</span>
          </span>
          <span v-if="contact(r.email, r.phone)" class="break-all text-toned">{{ contact(r.email, r.phone) }}</span>
          <span v-if="r.total" class="text-xs tabular-nums text-muted">{{ mssgMoneyText(r.total) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
