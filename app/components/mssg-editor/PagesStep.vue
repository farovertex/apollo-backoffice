<script setup lang="ts">
/**
 * FEAT-101 M2 — editor step 2 "Pages & Blocks · หน้าและเนื้อหา" (AC-20..24, AC-26; contract §3.2 / §3.3; design step 2).
 *
 * Pages: list of the draft's pages (`site` = local preview) with "+ สร้างหน้าใหม่", and for the selected page its
 * name / slug / show-hide / page SEO (`page.update`, folded), clone (`page.clone`), set as home (`page.setHome`) and
 * delete (`page.delete`, confirm; the home page cannot be deleted — the button is disabled with the reason).
 * Blocks of the selected page: edit (per-kind form), up / down (`block.move`), clone (`block.clone`), hide / show
 * (`block.update.enabled`), delete (`block.delete`, confirm); kinds Apollo does not know are read-only (move / hide /
 * delete still possible); blocks of a page cloned in this draft get their ids only on apply, so they are read-only
 * until then. "เพิ่ม block (Choose block)": the 19 kinds (Thai + English) → the kind's form → `block.create`.
 * Objects created in this draft carry temp ids (`tmp-…`); deleting one drops its ops instead of sending a delete.
 *
 * Every action emits ops to the page (→ `useMssgDraft`: autosave, rev); nothing here calls the API except uploads.
 * Field errors (draft 400 / apply `mssgValidation`) arrive as `errors` with their page / block / field target.
 */
import type { ModalProps } from '@nuxt/ui'
import type { MssgOp, MssgOpBlockCreate, MssgPageProjection, MssgSiteProjection } from '#shared/types/mssg-sites'
import type { MssgFieldError } from '~/utils/mssg-sites'
import type { MssgPageForm, MssgNewPageForm } from '~/utils/mssg-blocks'

const props = defineProps<{
  siteId: string
  site: MssgSiteProjection | null
  ops: MssgOp[]
  readOnly: boolean
  /** step-2 field errors (with `target`) */
  errors: MssgFieldError[]
  /** bumped when the draft was replaced from the server — forms re-read */
  resetToken: number
}>()

const emit = defineEmits<{
  pageUpdate: [pageId: string, fields: Extract<MssgOp, { op: 'page.update' }>['fields']]
  blockUpdate: [pageId: string, blockId: string, patch: { fields?: Record<string, unknown>, enabled?: boolean }]
  ops: [next: MssgOp[], clear?: (e: MssgFieldError) => boolean]
}>()

const selectedId = defineModel<string>('page', { default: '' })

const pages = computed(() => props.site?.pages ?? [])
const homeId = computed(() => props.site?.homePageId ?? pages.value[0]?.id ?? '')
const page = computed<MssgPageProjection | null>(() => pages.value.find(p => p.id === selectedId.value) ?? pages.value.find(p => p.id === homeId.value) ?? pages.value[0] ?? null)
watch(() => page.value?.id, (id) => {
  if (id && id !== selectedId.value) selectedId.value = id
}, { immediate: true })

const isHome = computed(() => !!page.value && page.value.id === homeId.value)
const clonedPage = computed(() => !!page.value && mssgIsClonedPage(props.ops, page.value.id))

// ── errors ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function pageErrors(pageId: string) {
  return props.errors.filter(e => e.target.pageId === pageId)
}
function pageFieldError(field: string): string | null {
  if (!page.value) return null
  return props.errors.find(e => e.target.pageId === page.value!.id && !e.target.blockId && e.target.field === field)?.message ?? null
}
function blockErrors(blockId: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const e of props.errors) {
    if (e.target.blockId === blockId && !out[e.target.field]) out[e.target.field] = e.message
  }
  return out
}
function blockErrorCount(blockId: string): number {
  return props.errors.filter(e => e.target.blockId === blockId).length
}
const pageLevelErrors = computed(() => (page.value ? props.errors.filter(e => e.target.pageId === page.value!.id && !e.target.blockId && !['name', 'slug', 'enabled', 'seo.title', 'seo.description'].includes(e.target.field)) : []))

// ── selected page form ──────────────────────────────────────────────────────────────────────────────────────────────
const pageState = reactive<MssgPageForm>({ name: '', slug: '', enabled: true, seo: { title: '', description: '' } })
function fromPage() {
  const p = page.value
  if (!p) return
  pageState.name = p.name ?? ''
  pageState.slug = p.slug ?? ''
  pageState.enabled = p.enabled !== false
  pageState.seo = { title: p.seo?.title ?? '', description: p.seo?.description ?? '' }
}
watch(() => [page.value?.id, props.resetToken] as const, fromPage, { immediate: true })

const otherSlugs = computed(() => pages.value.filter(p => p.id !== page.value?.id).map(p => p.slug))
const pageSchema = computed(() => mssgPageSchema.extend({
  slug: mssgPageSchema.shape.slug.refine(v => !otherSlugs.value.includes(v), 'ลิงก์นี้ใช้กับหน้าอื่นในเว็บนี้แล้ว')
}))

function onPageName(v: string) {
  pageState.name = v
  if (page.value && pageSchema.value.shape.name.safeParse(v).success) emit('pageUpdate', page.value.id, { name: v.trim() })
}
function onPageSlug(v: string) {
  pageState.slug = v
  if (page.value && pageSchema.value.shape.slug.safeParse(v).success) emit('pageUpdate', page.value.id, { slug: v })
}
function onPageEnabled(v: boolean) {
  pageState.enabled = v
  if (page.value) emit('pageUpdate', page.value.id, { enabled: v })
}
function onPageSeo(key: 'title' | 'description', v: string) {
  pageState.seo[key] = v
  if (page.value && mssgPageSchema.shape.seo.shape[key].safeParse(v).success) emit('pageUpdate', page.value.id, { seo: { [key]: v } })
}

// ── page actions ────────────────────────────────────────────────────────────────────────────────────────────────────
const newPageOpen = ref(false)
const newPage = reactive<MssgNewPageForm>({ name: '', slug: '' })
let slugEdited = false
const newPageSchema = computed(() => mssgNewPageSchema.extend({
  slug: mssgNewPageSchema.shape.slug.refine(v => !pages.value.some(p => p.slug === v), 'ลิงก์นี้ใช้กับหน้าอื่นในเว็บนี้แล้ว')
}))
function openNewPage() {
  newPage.name = ''
  newPage.slug = mssgSuggestSlug('', pages.value.map(p => p.slug))
  slugEdited = false
  newPageOpen.value = true
}
function onNewName(v: string) {
  newPage.name = v
  if (!slugEdited) newPage.slug = mssgSuggestSlug(v, pages.value.map(p => p.slug))
}
function onNewSlug(v: string) {
  slugEdited = true
  newPage.slug = v
}
function createPage() {
  const tempId = mssgTempId()
  emit('ops', [...props.ops, { op: 'page.create', tempId, name: newPage.name.trim(), slug: newPage.slug, enabled: true }])
  newPageOpen.value = false
  selectedId.value = tempId
}

function clonePage() {
  if (!page.value) return
  const tempId = mssgTempId()
  emit('ops', [...props.ops, { op: 'page.clone', pageId: page.value.id, tempId }])
  selectedId.value = tempId
}
function setHome() {
  if (!page.value || isHome.value) return
  const pageId = page.value.id
  emit('ops', [...props.ops, { op: 'page.setHome', pageId }])
}

const deletePageOpen = ref(false)
const deleteReason = computed(() => {
  if (isHome.value) return 'หน้าแรกลบไม่ได้ · ตั้งหน้าอื่นเป็นหน้าแรกก่อน'
  if (pages.value.length <= 1) return 'เว็บต้องมีอย่างน้อย 1 หน้า'
  return null
})
function deletePage() {
  const p = page.value
  deletePageOpen.value = false
  if (!p || deleteReason.value) return
  const dropped = mssgDropTempPage(props.ops, p.id)
  emit('ops', dropped ?? [...props.ops, { op: 'page.delete', pageId: p.id }], e => e.target.pageId === p.id)
  selectedId.value = homeId.value
}

// ── blocks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const blocks = computed(() => page.value?.blocks ?? [])
const editingId = ref<string | null>(null)
watch(() => page.value?.id, () => {
  editingId.value = null
  newKind.value = null
})
watch(blocks, (list) => {
  if (editingId.value && !list.some(b => b.id === editingId.value)) editingId.value = null
})

function canEdit(b: { id: string, kind: string }) {
  return mssgIsKnownKind(b.kind) && !clonedPage.value
}

function move(i: number, dir: -1 | 1) {
  const p = page.value
  const b = blocks.value[i]
  if (!p || !b) return
  const toIndex = i + dir
  if (toIndex < 0 || toIndex >= blocks.value.length) return
  const last = props.ops[props.ops.length - 1]
  // repeated moves of one block fold into one op (its target index changes, the order it starts from does not)
  if (last?.op === 'block.move' && last.pageId === p.id && last.blockId === b.id) {
    emit('ops', [...props.ops.slice(0, -1), { ...last, toIndex }])
  } else {
    emit('ops', [...props.ops, { op: 'block.move', pageId: p.id, blockId: b.id, toIndex }])
  }
}
function cloneBlock(blockId: string) {
  if (!page.value) return
  emit('ops', [...props.ops, { op: 'block.clone', pageId: page.value.id, blockId, tempId: mssgTempId() }])
}
function toggleBlock(blockId: string, enabled: boolean) {
  if (!page.value) return
  emit('blockUpdate', page.value.id, blockId, { enabled: !enabled })
}

const deleteBlockId = ref<string | null>(null)
const deleteBlockOpen = computed({
  get: () => deleteBlockId.value !== null,
  set: (v) => {
    if (!v) deleteBlockId.value = null
  }
})
const deleteBlockLabel = computed(() => {
  const b = blocks.value.find(x => x.id === deleteBlockId.value)
  if (!b) return ''
  const sum = mssgBlockSummary(b)
  return `${mssgBlockKindLabel(b.kind)}${sum ? ` · ${sum}` : ''}`
})
function deleteBlock() {
  const p = page.value
  const id = deleteBlockId.value
  deleteBlockId.value = null
  if (!p || !id) return
  const dropped = mssgDropTempBlock(props.ops, p.id, id)
  emit('ops', dropped ?? [...props.ops, { op: 'block.delete', pageId: p.id, blockId: id }], e => e.target.blockId === id)
  if (editingId.value === id) editingId.value = null
}

function onBlockChange(blockId: string, fields: Record<string, unknown>) {
  if (page.value) emit('blockUpdate', page.value.id, blockId, { fields })
}

// ── add ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const newKind = ref<string | null>(null)
const newIndex = ref<number | undefined>(undefined)
const newSeq = ref(0)
function startAdd(kind: string, index?: number) {
  editingId.value = null
  newKind.value = kind
  newIndex.value = index
  newSeq.value++
}
function addBlock(payload: { fields: Record<string, unknown>, enabled: boolean }) {
  const p = page.value
  const kind = newKind.value
  if (!p || !kind) return
  const tempId = mssgTempId()
  const op: MssgOpBlockCreate = { op: 'block.create', pageId: p.id, tempId, kind, fields: payload.fields, enabled: payload.enabled }
  if (newIndex.value !== undefined && newIndex.value < blocks.value.length) op.index = newIndex.value
  emit('ops', [...props.ops, op])
  newKind.value = null
  newIndex.value = undefined
}

// new errors arrive (draft 400 / apply): show the page and open the block of the first **new** one (fewer errors —
// the user fixing them — never moves the view)
const errKey = (e: MssgFieldError) => `${e.target.pageId}|${e.target.blockId}|${e.path}`
watch(() => props.errors.map(errKey), (keys, prev) => {
  const seen = new Set(prev ?? [])
  const first = props.errors.find(e => !seen.has(errKey(e)) && e.target.pageId && pages.value.some(p => p.id === e.target.pageId))
  if (!first) return
  selectedId.value = first.target.pageId!
  if (first.target.blockId) {
    void nextTick(() => {
      editingId.value = first.target.blockId
    })
  }
})

// UModal's root is renderless: the test id goes on the rendered dialog content
const newPageContent = { 'data-testid': 'me-page-new' } as ModalProps['content']

function toggleEdit(id: string) {
  editingId.value = editingId.value === id ? null : id
  newKind.value = null
}

const pageTitle = computed(() => page.value?.name || '—')
</script>

<template>
  <div class="flex min-w-0 flex-col gap-5" data-testid="me-sheet-2" :data-page-id="page?.id ?? ''">
    <!-- pages -->
    <section class="flex min-w-0 flex-col gap-3 rounded-lg border border-default bg-elevated/40 p-3 sm:p-4" aria-label="หน้าในเว็บ">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-sm font-semibold text-highlighted">หน้าในเว็บ (Pages)</span>
        <UButton
          label="+ สร้างหน้าใหม่ (Create new page)"
          color="primary"
          variant="soft"
          size="sm"
          :disabled="readOnly"
          data-testid="me-page-add"
          @click="openNewPage"
        />
      </div>
      <div role="group" aria-label="เลือกหน้า" class="flex flex-wrap gap-2">
        <UButton
          v-for="p in pages"
          :key="p.id"
          :color="p.id === page?.id ? 'primary' : 'neutral'"
          :variant="p.id === page?.id ? 'subtle' : 'outline'"
          size="sm"
          class="max-w-full"
          :aria-pressed="p.id === page?.id"
          :data-testid="`me-page-${p.id}`"
          :data-home="p.id === homeId ? 'true' : 'false'"
          :data-enabled="p.enabled ? 'true' : 'false'"
          :data-errors="pageErrors(p.id).length"
          @click="selectedId = p.id"
        >
          <UIcon
            v-if="p.id === homeId"
            name="i-lucide-house"
            class="size-3.5 shrink-0"
            aria-label="หน้าแรก"
          />
          <UIcon
            v-if="!p.enabled"
            name="i-lucide-eye-off"
            class="size-3.5 shrink-0"
            aria-label="ซ่อนอยู่"
          />
          <span class="truncate">{{ p.name || p.slug }} · {{ p.blocks.length }}</span>
          <UBadge
            v-if="pageErrors(p.id).length"
            :label="String(pageErrors(p.id).length)"
            color="error"
            size="sm"
          />
        </UButton>
      </div>
      <p v-if="!pages.length" class="text-sm text-muted" data-testid="me-pages-empty">
        เว็บนี้ยังไม่มีหน้า · กด "+ สร้างหน้าใหม่"
      </p>

      <UForm
        v-if="page"
        :schema="pageSchema"
        :state="pageState"
        :validate-on="['input']"
        :disabled="readOnly"
        class="flex flex-col gap-3 border-t border-default pt-3"
        data-testid="me-page-settings"
        :data-page-id="page.id"
      >
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MssgEditorFormText
            :model-value="pageState.name"
            name="name"
            label="ชื่อหน้า (Title)"
            testid="me-page-field"
            :maxlength="250"
            required
            :error="pageFieldError('name')"
            @update:model-value="onPageName"
          />
          <MssgEditorFormText
            :model-value="pageState.slug"
            name="slug"
            label="ลิงก์ของหน้า (slug)"
            description="a-z ตัวเล็ก ตัวเลข และ _ . -"
            testid="me-page-field"
            :maxlength="100"
            required
            :error="pageFieldError('slug')"
            @update:model-value="onPageSlug"
          />
          <MssgEditorFormText
            :model-value="pageState.seo.title"
            name="seo.title"
            label="SEO ของหน้านี้ · title"
            placeholder="Default · ใช้ค่าของเว็บ"
            testid="me-page-field"
            :maxlength="80"
            counter
            :error="pageFieldError('seo.title')"
            @update:model-value="onPageSeo('title', $event)"
          />
          <MssgEditorFormText
            :model-value="pageState.seo.description"
            name="seo.description"
            label="SEO ของหน้านี้ · description"
            placeholder="Default · ใช้ค่าของเว็บ"
            testid="me-page-field"
            :maxlength="200"
            counter
            :error="pageFieldError('seo.description')"
            @update:model-value="onPageSeo('description', $event)"
          />
        </div>
        <div class="flex items-center justify-between gap-3">
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm font-medium text-highlighted">แสดงหน้านี้</span>
            <span class="text-xs text-muted">{{ pageState.enabled ? 'แสดงอยู่' : 'ซ่อนอยู่ · คนทั่วไปเปิดหน้านี้ไม่ได้' }}</span>
          </span>
          <USwitch
            :model-value="pageState.enabled"
            :disabled="readOnly"
            aria-label="แสดงหน้านี้"
            data-testid="me-page-field-enabled"
            @update:model-value="onPageEnabled(!!$event)"
          />
        </div>
        <span v-if="pageFieldError('enabled')" class="text-xs text-error" data-testid="me-page-field-error-enabled">{{ pageFieldError('enabled') }}</span>
        <UAlert
          v-for="(e, i) in pageLevelErrors"
          :key="`${i}-${e.path}`"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="`หน้า &quot;${pageTitle}&quot;: ${e.message}`"
          data-testid="me-page-error"
          :data-path="e.path"
        />
        <div class="flex flex-wrap gap-2">
          <UButton
            label="โคลนหน้า (Clone)"
            icon="i-lucide-copy"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="readOnly"
            :data-testid="`me-page-clone-${page.id}`"
            @click="clonePage"
          />
          <UButton
            :label="isHome ? 'หน้าแรกของเว็บ' : 'ตั้งเป็นหน้าแรก'"
            icon="i-lucide-house"
            color="neutral"
            variant="outline"
            size="sm"
            :disabled="readOnly || isHome"
            :data-testid="`me-page-home-${page.id}`"
            @click="setHome"
          />
          <UButton
            label="ลบหน้า (Delete page)"
            icon="i-lucide-trash-2"
            color="error"
            variant="outline"
            size="sm"
            :disabled="readOnly || !!deleteReason"
            :title="deleteReason ?? undefined"
            :data-reason="deleteReason ?? ''"
            :data-testid="`me-page-delete-${page.id}`"
            @click="deletePageOpen = true"
          />
        </div>
        <span v-if="deleteReason" class="text-xs text-muted" data-testid="me-page-delete-reason">{{ deleteReason }}</span>
      </UForm>
    </section>

    <!-- blocks -->
    <section v-if="page" class="flex min-w-0 flex-col gap-3" aria-label="block ของหน้า">
      <p class="text-sm break-words text-toned">
        block ของหน้า "{{ pageTitle }}" · แก้ เลื่อนขึ้นลง โคลน ซ่อน หรือลบได้เหมือนใน mssg
      </p>
      <p v-if="clonedPage" class="text-xs text-warning" data-testid="me-blocks-cloned-note">
        หน้านี้โคลนในร่างนี้ · block จะแก้ได้หลังกด "บันทึก" (mssg ให้รหัส block ใหม่ตอนโคลนจริง)
      </p>
      <div
        v-if="!blocks.length"
        class="rounded-md border border-dashed border-default p-4 text-center text-sm text-muted"
        data-testid="me-blocks-empty"
      >
        หน้านี้ยังไม่มี block · เลือก block ด้านล่างเพื่อเพิ่ม block แรก
      </div>
      <ul
        v-else
        class="flex flex-col gap-2"
        data-testid="me-blocks"
        :data-page-id="page.id"
        :data-count="blocks.length"
      >
        <li
          v-for="(b, i) in blocks"
          :key="b.id"
          class="flex min-w-0 flex-col gap-2"
          :data-testid="`me-block-${b.id}`"
          :data-kind="b.kind"
          :data-enabled="b.enabled ? 'true' : 'false'"
          :data-index="i"
          :data-errors="blockErrorCount(b.id)"
        >
          <div
            class="flex min-w-0 flex-wrap items-center gap-2 rounded-md border bg-default px-3 py-2"
            :class="blockErrorCount(b.id) ? 'border-error/60' : (editingId === b.id ? 'border-primary/60' : 'border-default')"
          >
            <span class="flex min-w-0 flex-[1_1_12rem] flex-col gap-0.5" :class="b.enabled ? '' : 'opacity-60'">
              <span class="flex flex-wrap items-center gap-1.5 text-xs">
                <span class="font-medium text-highlighted">{{ mssgBlockKindLabel(b.kind) }}</span>
                <UBadge
                  v-if="!b.enabled"
                  label="ซ่อนอยู่"
                  color="neutral"
                  variant="subtle"
                  size="sm"
                />
                <UBadge
                  v-if="!mssgIsKnownKind(b.kind)"
                  label="อ่านอย่างเดียว"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  title="Apollo ยังแก้ block ชนิดนี้ไม่ได้ · เลื่อน ซ่อน หรือลบได้"
                  :data-testid="`me-block-unknown-${b.id}`"
                />
                <UBadge
                  v-if="mssgIsTempId(b.id)"
                  label="ใหม่"
                  color="primary"
                  variant="subtle"
                  size="sm"
                />
                <UBadge
                  v-if="blockErrorCount(b.id)"
                  :label="`ต้องแก้ ${blockErrorCount(b.id)}`"
                  color="error"
                  size="sm"
                />
              </span>
              <span v-if="mssgBlockSummary(b)" class="truncate text-sm text-toned">{{ mssgBlockSummary(b) }}</span>
            </span>
            <div class="flex flex-wrap items-center gap-1">
              <UButton
                v-if="canEdit(b)"
                :label="editingId === b.id ? 'ปิด' : 'แก้'"
                icon="i-lucide-pencil"
                color="neutral"
                variant="outline"
                size="xs"
                :data-testid="`me-block-edit-${b.id}`"
                @click="toggleEdit(b.id)"
              />
              <UButton
                icon="i-lucide-chevron-up"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="เลื่อนขึ้น"
                :disabled="readOnly || i === 0 || clonedPage"
                :data-testid="`me-block-up-${b.id}`"
                @click="move(i, -1)"
              />
              <UButton
                icon="i-lucide-chevron-down"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="เลื่อนลง"
                :disabled="readOnly || i === blocks.length - 1 || clonedPage"
                :data-testid="`me-block-down-${b.id}`"
                @click="move(i, 1)"
              />
              <UButton
                label="โคลน"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="readOnly || clonedPage"
                :data-testid="`me-block-clone-${b.id}`"
                @click="cloneBlock(b.id)"
              />
              <UButton
                :label="b.enabled ? 'ซ่อน' : 'แสดง'"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="readOnly || clonedPage"
                :data-testid="`me-block-hide-${b.id}`"
                @click="toggleBlock(b.id, b.enabled)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="ghost"
                size="xs"
                aria-label="ลบ block"
                :disabled="readOnly || clonedPage"
                :data-testid="`me-block-delete-${b.id}`"
                @click="deleteBlockId = b.id"
              />
            </div>
          </div>
          <MssgEditorBlockForm
            v-if="editingId === b.id && canEdit(b)"
            :key="`${b.id}:${resetToken}`"
            :kind="b.kind"
            :fields="b.fields"
            mode="edit"
            :site-id="siteId"
            :pages="pages"
            :read-only="readOnly"
            :errors="blockErrors(b.id)"
            @change="onBlockChange(b.id, $event)"
            @close="editingId = null"
            @add-link="startAdd('Link', i + 1)"
          />
        </li>
      </ul>

      <div v-if="newKind" data-testid="me-block-new">
        <MssgEditorBlockForm
          :key="`new:${newKind}:${newSeq}`"
          :kind="newKind"
          :fields="{}"
          mode="new"
          :site-id="siteId"
          :pages="pages"
          :read-only="readOnly"
          @submit="addBlock"
          @cancel="newKind = null"
        />
      </div>

      <div class="flex min-w-0 flex-col gap-2 rounded-lg border border-default bg-elevated/40 p-3" data-testid="me-block-add">
        <span class="text-sm text-default">เพิ่ม block (Choose block)</span>
        <ul class="grid grid-cols-1 gap-1.5 min-[420px]:grid-cols-2 xl:grid-cols-3">
          <li v-for="k in MSSG_BLOCK_KINDS" :key="k.kind">
            <button
              type="button"
              class="flex min-h-11 w-full items-center gap-2.5 rounded-md border border-default bg-default px-2.5 py-1.5 text-start hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50"
              :class="newKind === k.kind ? 'border-primary' : ''"
              :disabled="readOnly || clonedPage"
              :aria-pressed="newKind === k.kind"
              :data-testid="`me-block-kind-${k.kind}`"
              @click="startAdd(k.kind)"
            >
              <span class="flex size-7 shrink-0 items-center justify-center rounded bg-primary/10 text-[11px] font-semibold text-primary" aria-hidden="true">{{ k.glyph }}</span>
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-sm text-highlighted">{{ k.en }}</span>
                <span class="truncate text-xs text-muted">{{ k.th }}</span>
              </span>
              <span class="text-primary" aria-hidden="true">+</span>
            </button>
          </li>
        </ul>
      </div>
    </section>

    <!-- dialogs -->
    <UModal
      v-model:open="newPageOpen"
      title="สร้างหน้าใหม่ (Create new page)"
      :ui="{ content: 'max-w-md' }"
      :content="newPageContent"
    >
      <template #body>
        <UForm
          id="me-page-new-form"
          :schema="newPageSchema"
          :state="newPage"
          :validate-on="['input']"
          class="flex flex-col gap-3"
          @submit="createPage"
        >
          <MssgEditorFormText
            :model-value="newPage.name"
            name="name"
            label="ชื่อหน้า (Title)"
            testid="me-page-new"
            :maxlength="250"
            required
            @update:model-value="onNewName"
          />
          <MssgEditorFormText
            :model-value="newPage.slug"
            name="slug"
            label="ลิงก์ของหน้า (slug)"
            description="a-z ตัวเล็ก ตัวเลข และ _ . - · ไม่ซ้ำกับหน้าอื่น"
            testid="me-page-new"
            :maxlength="100"
            required
            @update:model-value="onNewSlug"
          />
        </UForm>
      </template>
      <template #footer>
        <div class="flex w-full flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            data-testid="me-page-new-cancel"
            @click="newPageOpen = false"
          />
          <UButton
            type="submit"
            form="me-page-new-form"
            label="สร้างหน้า"
            data-testid="me-page-new-ok"
          />
        </div>
      </template>
    </UModal>
    <MssgEditorConfirmModal
      v-model:open="deletePageOpen"
      :title="`ลบหน้า &quot;${pageTitle}&quot;?`"
      description="หน้านี้และ block ทั้งหมดในหน้าจะถูกลบจาก mssg เมื่อกด &quot;บันทึก&quot; (ระบบถามยืนยันอีกครั้งตอนบันทึก)"
      confirm-label="ลบหน้า"
      testid="me-confirm-page-delete"
      @confirm="deletePage"
    />
    <MssgEditorConfirmModal
      v-model:open="deleteBlockOpen"
      title="ลบ block นี้?"
      :items="deleteBlockLabel ? [deleteBlockLabel] : []"
      description="block จะถูกลบจาก mssg เมื่อกด &quot;บันทึก&quot; (ระบบถามยืนยันอีกครั้งตอนบันทึก)"
      confirm-label="ลบ block"
      testid="me-confirm-block-delete"
      @confirm="deleteBlock"
    />
  </div>
</template>
