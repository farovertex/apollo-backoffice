/**
 * FEAT-101 (B3 note 1, M4) — when a step form re-reads the draft into its local state.
 *
 * A form keeps its own state so an invalid, unsent value (a 2-character name, an out-of-range number) stays on screen with
 * its message while the user edits another field. It must therefore re-read the draft **only** when it opens, when the
 * edited object changes (page id) or when the draft was replaced from the server (`resetToken`) — never because the
 * preview object was rebuilt after an unrelated edit.
 *
 * The bug this prevents: `watch(() => [page.value?.id, token] as const, reread)` returns a **new array on every run**,
 * and the getter also tracks the `page` computed, so every edit (which rebuilds the preview, hence `page`) fired
 * `reread` and wiped the invalid value. A list of getters is compared **per source**, so it fires only when one value
 * really changed.
 */
import { watch } from 'vue'
import type { WatchHandle, WatchSource } from 'vue'

export function mssgWatchFormReset(sources: WatchSource[], reread: () => void): WatchHandle {
  return watch(sources, reread, { immediate: true })
}
