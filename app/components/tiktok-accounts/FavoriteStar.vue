<script setup lang="ts">
/**
 * FEAT-063 — the star after an account's name on `/tiktok-accounts` (`ta-fav`) and `/launch-ads` (`la-acc-fav` /
 * `la-review-fav`). One component, three call sites: the caller only ever passes `accountId` + the row's
 * effective `favorite` and listens to `update:favorite` to update its own override map (AC-5/AC-6/AC-7) — this
 * component owns the request, the optimistic flip, the revert-on-failure and the toast.
 *
 * Clickable mode (`readonly` unset/false): a ghost `xs` `square` `UButton` (24×24 px hit target) with icon
 * `i-lucide-star`; `stopPropagation` so a star inside a selectable row (`la-acc-row`) never changes the
 * selection. Click → optimistic flip emitted immediately, then `PUT` (turning favorite on) / `DELETE` (turning it
 * off) `/tiktok-accounts/:id/favorite` via `useAccountFavorite()` (`retry: 0`); success re-emits the server's own
 * `favorite` (idempotent, so a slow double click settles on the same value), failure re-emits the previous value
 * and shows one `useToast()` error ("Favorite not saved"). `loading`/`disabled` while that request is in flight —
 * no double request for the same row.
 *
 * Readonly mode (`readonly: true`, used by `la-review-target`): a static `UIcon`, no button, no request, no
 * states — just the two visual states of the star.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'

const props = withDefaults(defineProps<{
  accountId: string
  favorite: boolean
  /** `data-testid` of the rendered element; defaults to the `/tiktok-accounts` id */
  testid?: string
  /** static display only (step-3 review target) — no button, no click, no request */
  readonly?: boolean
}>(), {
  testid: 'ta-fav',
  readonly: false
})

const emit = defineEmits<{
  'update:favorite': [boolean]
}>()

const { toggleFavorite } = useAccountFavorite()
const toast = useToast()

const loading = ref(false)

async function onClick() {
  if (props.readonly || loading.value) return
  const previous = props.favorite
  const next = !previous
  // optimistic flip — the caller's override map is the only source of truth until the request settles
  emit('update:favorite', next)
  loading.value = true
  try {
    const favorite = await toggleFavorite(props.accountId, next)
    emit('update:favorite', favorite)
  } catch (e) {
    emit('update:favorite', previous)
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: 'Favorite not saved',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

const starClass = computed(() => props.favorite ? 'text-warning [&_path]:fill-current' : 'text-muted')
</script>

<template>
  <UIcon
    v-if="readonly"
    name="i-lucide-star"
    :class="starClass"
    :data-testid="testid"
    :data-favorite="favorite ? 'true' : 'false'"
    :data-id="accountId"
    title="Favorite"
  />
  <UButton
    v-else
    variant="ghost"
    size="xs"
    square
    icon="i-lucide-star"
    :loading="loading"
    :disabled="loading"
    :ui="{ leadingIcon: starClass }"
    :data-testid="testid"
    :data-favorite="favorite ? 'true' : 'false'"
    :data-id="accountId"
    :aria-label="favorite ? 'Remove from favorites' : 'Add to favorites'"
    title="Favorite"
    @click.stop="onClick"
  />
</template>
