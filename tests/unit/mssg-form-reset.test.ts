/**
 * FEAT-101 B3 note 1 / B4 — `PagesStep` (B2) re-read the draft after every edit because its watcher returned a new array
 * and tracked the rebuilt `page` computed, so an invalid, unsent value (a 2-character page name) was wiped as soon as
 * another field was edited. `mssgWatchFormReset` compares per source, so only a page change, a server reset or the first
 * run re-reads. The scenario below is `PagesStep`'s: `site` (the local preview) is rebuilt on every edit, `page` is a
 * computed over it, the form state is a local object.
 */
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { describe, expect, it } from 'vitest'
import { mssgWatchFormReset } from '../../app/utils/mssg-form-reset'

interface Page { id: string, name: string, slug: string }

function setup(mode: 'old' | 'fixed') {
  const site = ref<{ pages: Page[] }>({ pages: [{ id: 'p1', name: 'Homepage', slug: 'home' }, { id: 'p2', name: 'About', slug: 'about' }] })
  const selected = ref('p1')
  const resetToken = ref(0)
  const page = computed(() => site.value.pages.find(p => p.id === selected.value) ?? null)
  const state = reactive({ name: '', slug: '' })
  let rereads = 0
  const fromPage = () => {
    rereads++
    state.name = page.value?.name ?? ''
    state.slug = page.value?.slug ?? ''
  }
  if (mode === 'old') watch(() => [page.value?.id, resetToken.value] as const, fromPage, { immediate: true })
  else mssgWatchFormReset([() => page.value?.id, () => resetToken.value], fromPage)

  /** an edit of the draft: the server / local preview is rebuilt (new objects), the form is not the source */
  const rebuildPreview = (patch: Partial<Page>) => {
    site.value = { pages: site.value.pages.map(p => ({ ...p, ...(p.id === selected.value ? patch : {}) })) }
  }
  return { site, selected, resetToken, state, rebuildPreview, rereads: () => rereads }
}

describe('mssgWatchFormReset (PagesStep watcher bug, B3 note 1)', () => {
  it('reads the page once when the form opens', async () => {
    const t = setup('fixed')
    await nextTick()
    expect(t.rereads()).toBe(1)
    expect(t.state).toEqual({ name: 'Homepage', slug: 'home' })
  })

  it('keeps an invalid, unsent name while another field is edited (the preview is rebuilt)', async () => {
    const t = setup('fixed')
    await nextTick()
    t.state.name = 'ab' // invalid (< 3): never sent, so the preview still has the old name
    t.rebuildPreview({ slug: 'home-2' }) // the user then edits the slug: valid → sent → the preview is rebuilt
    await nextTick()
    expect(t.rereads()).toBe(1)
    expect(t.state.name).toBe('ab')
  })

  it('the old pattern wiped it (regression guard: this is the bug)', async () => {
    const t = setup('old')
    await nextTick()
    t.state.name = 'ab'
    t.rebuildPreview({ slug: 'home-2' })
    await nextTick()
    expect(t.rereads()).toBe(2)
    expect(t.state.name).toBe('Homepage')
  })

  it('re-reads when another page is selected', async () => {
    const t = setup('fixed')
    await nextTick()
    t.state.name = 'ab'
    t.selected.value = 'p2'
    await nextTick()
    expect(t.rereads()).toBe(2)
    expect(t.state).toEqual({ name: 'About', slug: 'about' })
  })

  it('re-reads when the draft was replaced from the server (resetToken)', async () => {
    const t = setup('fixed')
    await nextTick()
    t.state.name = 'ab'
    t.resetToken.value++
    await nextTick()
    expect(t.rereads()).toBe(2)
    expect(t.state.name).toBe('Homepage')
  })
})
