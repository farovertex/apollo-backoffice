<script setup lang="ts">
/**
 * FEAT-101 reopen (B2r; contract v1.6 §3.4 "Menu", AC-48) — "เมนู (Menu)" of step 2, below the pages.
 *
 * `menu.enabled` switch and one row per page that exists on mssg (label 1–100, shown / hidden, up / down), in the order
 * of the draft's menu (`mssgMenuRows`). Every edit emits `update` with `{ enabled }` or `{ items }` — `items` is the
 * whole ordered list — which the editor folds into the draft's single `site.update` (`menu` key). A label that breaks
 * the rule stays in its field with the Thai message and is not sent. Pages created in this draft get no row: mssg
 * creates them, they can be put in the menu after the next "บันทึก" (note). A site without a menu (`menu: null`) shows a
 * note only.
 * Server messages (draft 400 `ops.<n>.fields.menu.…`, apply `site.menu.…`) arrive as `errors` (path `menu.…`).
 * Test ids: `me-menu` (`data-enabled`, `data-count`), `me-menu-enabled`, `me-menu-item-<pageId>` (`data-index`,
 * `data-enabled`), `me-menu-label-<pageId>` (+ `me-menu-label-error-<pageId>`), `me-menu-shown-<pageId>`,
 * `me-menu-up-<pageId>`, `me-menu-down-<pageId>`, `me-menu-new-page-note`, `me-menu-none`, `me-menu-error` (`data-path`).
 */
import type { MssgSiteMenuItem, MssgSiteProjection } from '#shared/types/mssg-sites'
import type { MssgFieldError } from '~/utils/mssg-sites'
import type { MssgMenuRow } from '~/utils/mssg-menu'

const props = defineProps<{
  site: MssgSiteProjection | null
  readOnly: boolean
  /** step-2 errors whose path starts with `menu` */
  errors: MssgFieldError[]
  resetToken: number
}>()

const emit = defineEmits<{ update: [menu: { enabled?: boolean, items?: MssgSiteMenuItem[] }] }>()

const menu = computed(() => props.site?.menu ?? null)
const rows = computed(() => mssgMenuRows(props.site))
const newPages = computed(() => mssgMenuNewPages(props.site))

// label fields are local (an invalid label stays visible); re-read on a server reset or when the set of rows changes
const labels = reactive<Record<string, string>>({})
const labelErrors = reactive<Record<string, string>>({})
function reread() {
  for (const k of Object.keys(labels)) Reflect.deleteProperty(labels, k)
  for (const k of Object.keys(labelErrors)) Reflect.deleteProperty(labelErrors, k)
  for (const r of rows.value) labels[r.page] = r.label
}
mssgWatchFormReset([() => props.resetToken, () => rows.value.map(r => r.page).sort().join(',')], reread)

function emitItems(next: MssgMenuRow[]) {
  if (props.readOnly) return
  emit('update', { items: mssgMenuItems(next) })
}
function onEnabled(v: boolean) {
  if (!props.readOnly) emit('update', { enabled: v })
}
function onLabel(page: string, v: string) {
  labels[page] = v
  const r = mssgMenuLabelSchema.safeParse(v)
  if (!r.success) {
    labelErrors[page] = r.error.issues[0]?.message ?? 'ชื่อในเมนูไม่ถูกต้อง'
    return
  }
  Reflect.deleteProperty(labelErrors, page)
  emitItems(mssgMenuSet(rows.value, page, { label: r.data }))
}
function onShown(page: string, v: boolean) {
  emitItems(mssgMenuSet(rows.value, page, { enabled: v }))
}
function move(page: string, dir: -1 | 1) {
  emitItems(mssgMenuMove(rows.value, page, dir))
}

function serverError(page: string): string | null {
  const i = rows.value.findIndex(r => r.page === page)
  return props.errors.find(e => e.path === `menu.items.${i}.label` || e.path === `menu.items.${i}`)?.message ?? null
}
const generalErrors = computed(() => props.errors.filter(e => !/^menu\.items\.\d+(\.label)?$/.test(e.path)))
</script>

<template>
  <section
    class="flex min-w-0 flex-col gap-3 rounded-lg border border-default bg-elevated/40 p-3 sm:p-4"
    aria-label="เมนูของเว็บ"
    data-testid="me-menu"
    :data-enabled="menu?.enabled ? 'true' : 'false'"
    :data-count="rows.length"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="text-sm font-semibold text-highlighted">เมนู (Menu)</span>
        <span class="text-xs text-muted">ลำดับ ชื่อ และการแสดงหน้าในเมนูของเว็บ</span>
      </span>
      <USwitch
        v-if="menu"
        :model-value="!!menu.enabled"
        :disabled="readOnly"
        :label="menu.enabled ? 'แสดงเมนู' : 'ซ่อนเมนู'"
        data-testid="me-menu-enabled"
        @update:model-value="onEnabled(!!$event)"
      />
    </div>

    <p v-if="!menu" class="text-sm text-muted" data-testid="me-menu-none">
      เว็บนี้ยังไม่มีเมนูจาก mssg · แก้เมนูได้เมื่อ mssg สร้างเมนูให้แล้ว
    </p>
    <template v-else>
      <UAlert
        v-for="(e, i) in generalErrors"
        :key="`${i}-${e.path}`"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="`เมนู: ${e.message}`"
        data-testid="me-menu-error"
        :data-path="e.path"
      />
      <ol class="flex min-w-0 flex-col gap-2" :class="menu.enabled ? '' : 'opacity-70'">
        <li
          v-for="(r, i) in rows"
          :key="r.page"
          class="flex min-w-0 flex-wrap items-start gap-2 rounded-md border border-default bg-default px-2.5 py-2"
          :data-testid="`me-menu-item-${r.page}`"
          :data-index="i"
          :data-enabled="r.enabled ? 'true' : 'false'"
        >
          <span class="mt-2 w-5 shrink-0 text-center text-xs text-muted tabular-nums">{{ i + 1 }}</span>
          <div class="flex min-w-0 flex-[1_1_12rem] flex-col gap-1">
            <UInput
              :model-value="labels[r.page] ?? r.label"
              :placeholder="r.name"
              :disabled="readOnly"
              :aria-label="`ชื่อในเมนูของหน้า ${r.name}`"
              maxlength="120"
              class="w-full"
              :data-testid="`me-menu-label-${r.page}`"
              @update:model-value="onLabel(r.page, String($event ?? ''))"
            />
            <span class="truncate text-[11px] text-dimmed">หน้า: {{ r.name }}</span>
            <span
              v-if="labelErrors[r.page] || serverError(r.page)"
              class="text-xs text-error"
              :data-testid="`me-menu-label-error-${r.page}`"
            >{{ labelErrors[r.page] || serverError(r.page) }}</span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <USwitch
              :model-value="r.enabled"
              :disabled="readOnly"
              size="sm"
              :aria-label="`แสดงหน้า ${r.name} ในเมนู`"
              :title="r.enabled ? 'แสดงในเมนู' : 'ซ่อนจากเมนู'"
              :data-testid="`me-menu-shown-${r.page}`"
              @update:model-value="onShown(r.page, !!$event)"
            />
            <UButton
              icon="i-lucide-chevron-up"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="เลื่อนขึ้นในเมนู"
              :disabled="readOnly || i === 0"
              :data-testid="`me-menu-up-${r.page}`"
              @click="move(r.page, -1)"
            />
            <UButton
              icon="i-lucide-chevron-down"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="เลื่อนลงในเมนู"
              :disabled="readOnly || i === rows.length - 1"
              :data-testid="`me-menu-down-${r.page}`"
              @click="move(r.page, 1)"
            />
          </div>
        </li>
      </ol>
      <p v-if="!rows.length" class="text-sm text-muted">
        ยังไม่มีหน้าบน mssg ที่ใส่ในเมนูได้
      </p>
    </template>
    <p v-if="newPages.length" class="text-xs break-words text-muted" data-testid="me-menu-new-page-note">
      หน้าที่สร้างในร่างนี้ ({{ newPages.map(p => p.name).join(', ') }}) จะจัดในเมนูได้หลังกด "บันทึก" (mssg สร้างหน้าก่อน แล้วจึงแก้เมนูได้)
    </p>
  </section>
</template>
