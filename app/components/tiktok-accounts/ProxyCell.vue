<script setup lang="ts">
/**
 * FEAT-070 (spec "UI behaviour", api-contract.md v1 §6) — the **Proxy** cell of `/tiktok-accounts`: the proxy of
 * the account's browser profile on two lines plus two icon-only actions (xs, outline, neutral, tooltip always on —
 * the `ta-sub-create-*` pattern: the tooltip trigger is a `span` so it still opens while the button is disabled).
 *   · line 1 `ta-proxy-name` — `proxyRef.label`, else the provider snapshot (`formatProxySnapshot`), else `—`;
 *     `title` = `type host:port[ · country]`.
 *   · line 2 `ta-proxy-check-state[data-ok=true|false|never]` — only when there is a `proxyRef`; replaced by the
 *     `ta-proxy-updating` badge while a `provider{setProxy}` job runs (API flag or the page's optimistic mark).
 *   · `ta-proxy-check` → `check`, `ta-proxy-edit` → `edit`; the page owns every request, this only renders.
 * The enable rules and tooltip texts are the `/browser-profiles` ones (`canEditProxy` / `proxyReason`), worded for
 * a page that cannot close the browser itself.
 */
import type { AccountBrowserProfile } from '#shared/types/tiktok-accounts'
import type { ProxyLastCheck } from '#shared/types/proxies'

const props = defineProps<{
  /** `account.browserProfileId` — still known when the profile row is gone */
  profileId: string
  profile: AccountBrowserProfile | null
  /** the row's last check, our own fresh result merged over the API's `proxyLastCheck` */
  lastCheck: ProxyLastCheck | null
  /** relative time of `lastCheck.at` (the page owns the clock) */
  checkedAgo: string | null
  /** API `proxyUpdating` ∨ the page's optimistic mark after a 202 */
  updating: boolean
  /** this row's `POST /proxies/:id/check` is in flight */
  checking: boolean
}>()

const emit = defineEmits<{
  check: []
  edit: []
}>()

const UPDATING = 'Updating proxy…'

const proxyRef = computed(() => props.profile?.proxyRef ?? null)

/** `type host:port[ · country]` of the picked proxy row, else of the provider snapshot; null = no proxy at all */
const endpoint = computed<string | null>(() => {
  const ref = proxyRef.value
  if (ref) {
    const main = `${ref.type} ${ref.host}:${ref.port}`
    return ref.country ? `${main} · ${ref.country}` : main
  }
  return formatProxySnapshot(props.profile?.proxy ?? null)
})

const name = computed(() => proxyRef.value?.label ?? formatProxySnapshot(props.profile?.proxy ?? null) ?? '—')

const checkState = computed<'true' | 'false' | 'never'>(() => {
  const c = props.lastCheck
  if (!c) return 'never'
  return c.ok ? 'true' : 'false'
})

/** null = enabled; otherwise the disabled tooltip (contract §6 "Texts") */
const checkBlocked = computed<string | null>(() => {
  if (!props.profile) return 'No browser profile'
  if (props.updating) return UPDATING
  if (!proxyRef.value) return 'No proxy to check — set one with Change proxy'
  return null
})

const editBlocked = computed<string | null>(() => {
  const p = props.profile
  if (!p) return 'No browser profile'
  if (props.updating) return UPDATING
  if (!p.providerProfileId || p.runState === 'provisioning') return 'Profile is still being created'
  if (p.runState === 'opening' || p.runState === 'open' || p.runState === 'closing') {
    return 'Profile is open — close it on Browser profiles first'
  }
  // left: `closed` / `error` — AdsPower only applies `user_proxy_config` on the next launch (TASK-profile-proxy)
  return null
})
</script>

<template>
  <div
    class="flex min-w-0 items-center gap-2"
    data-testid="ta-proxy"
    :data-profile-id="profileId"
    :data-proxy-id="proxyRef?.id ?? ''"
  >
    <div class="flex min-w-0 flex-1 flex-col">
      <span
        class="max-w-40 truncate text-highlighted"
        :title="endpoint ?? undefined"
        data-testid="ta-proxy-name"
      >{{ name }}</span>
      <span
        v-if="updating"
        class="flex items-center gap-1 whitespace-nowrap text-xs text-muted"
        title="The node is writing the new proxy into the AdsPower profile"
        data-testid="ta-proxy-updating"
      >
        <UIcon name="i-lucide-loader-circle" class="size-3.5 shrink-0 animate-spin text-primary" />
        Updating proxy…
      </span>
      <span
        v-else-if="proxyRef"
        class="whitespace-nowrap text-xs"
        :class="checkState === 'true' ? 'text-success' : checkState === 'false' ? 'text-error' : 'text-muted'"
        :title="lastCheck ? (lastCheck.ok ? (lastCheck.ip ?? undefined) : (lastCheck.error ?? undefined)) : undefined"
        :data-ok="checkState"
        data-testid="ta-proxy-check-state"
      >{{ lastCheck ? `${lastCheck.ok ? '✓' : '✗'} ${checkedAgo ?? ''}`.trim() : 'never checked' }}</span>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <UTooltip :text="checkBlocked ?? 'Check proxy'">
        <span class="inline-flex">
          <UButton
            icon="i-lucide-activity"
            color="neutral"
            variant="outline"
            size="xs"
            :disabled="!!checkBlocked"
            :loading="checking"
            aria-label="Check proxy"
            data-testid="ta-proxy-check"
            @click="emit('check')"
          />
        </span>
      </UTooltip>
      <UTooltip :text="editBlocked ?? 'Change proxy'">
        <span class="inline-flex">
          <UButton
            icon="i-lucide-network"
            color="neutral"
            variant="outline"
            size="xs"
            :disabled="!!editBlocked"
            aria-label="Change proxy"
            data-testid="ta-proxy-edit"
            @click="emit('edit')"
          />
        </span>
      </UTooltip>
    </div>
  </div>
</template>
