<script setup lang="ts">
/**
 * FEAT-059 — the Business Center orgs of one TikTok account, rendered under its row on `/tiktok-accounts`
 * (spec.md "UI behaviour", AC-13..17; api-contract.md v1 §7 `OrganizationView` / §8).
 *
 * Pure presentation: the page owns `useApi()`, the per-account cache, the discover poll and every request, and
 * hands the whole state in (`pending` / `error` / `data`) exactly like `ReportBannedCampaigns` does for
 * `/reports/banned`. The component only renders and emits.
 *
 * Why a **nested** `<table>`: the account table is a Nuxt UI `UTable`, which owns its `<tbody>` and gives an
 * expanded row exactly one `<tr>` with one `<td colspan>`. The org rows are therefore real `<tr>` elements of a
 * table inside that cell — `[data-testid="ta-org-row"]` is a `<tr>` as the spec asks, it is just not a sibling
 * of `ta-row`'s `<tr>`. Below `sm` the same rows stack (`flex` on the `<tr>`, `block` on the cells) so a phone
 * shows badge + name on one line and count / synced / Sync on the next without a second DOM (a duplicated test
 * id would break Playwright's strict mode).
 *
 * Because the expansion lives inside the account table's `overflow-x-auto` wrapper, the content is pinned with
 * `sticky left-0` and a viewport-bound width on mobile (same trick as `ReportBannedCampaigns`): scrolling the
 * wide account table sideways keeps the org rows visible.
 */
import type { BcOrganization, OrganizationsState, TikTokAccount } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  account: TikTokAccount
  state?: OrganizationsState
  /** API error text of the last parent PATCH, keyed by `orgId` */
  parentErrors?: Record<string, string>
  /** `orgId` whose parent PATCH is in flight */
  parentBusy?: string | null
  /** why every Sync button of this account is disabled (same reason as the row action); `null` = enabled */
  syncBlocked?: string | null
  /** `orgId` whose `POST …/discover` is in flight (button spinner, no double click) */
  syncStarting?: string | null
}>()

const emit = defineEmits<{
  'retry': []
  'sync': [org: BcOrganization]
  'advertisers': [org: BcOrganization]
  /** the copy button of `ta-org-name` — the page owns the clipboard toast (same as `ta-bc-org-copy`) */
  'copy': [org: BcOrganization]
  'set-parent': [payload: { org: BcOrganization, parentOrgId: string | null }]
}>()

/** the relative "synced" text follows the clock like the Advertisers column of the account row */
const now = useNow({ interval: 30_000 })
const nowMs = computed(() => now.value.getTime())

const loading = computed(() => !props.state || props.state.pending)
const error = computed(() => props.state?.error ?? null)
/** order as delivered by the API (root · subs · unknown parent · missing) — never re-sorted here */
const orgs = computed<BcOrganization[]>(() => props.state?.data ?? [])
const roots = computed(() => orgs.value.filter(org => org.isRoot))

/** sentinel of the "clear the parent" item — `PATCH { parentOrgId: null }` (an empty string is not a valid id) */
const NO_PARENT_VALUE = '__none__'
const NO_PARENT_LABEL = '— ไม่ตั้ง —'
/**
 * The select is an action menu, not a field: it is **always** bound to this empty value (no item carries it, so
 * the placeholder stays) and the page re-reads the orgs after the PATCH. Leaving it uncontrolled would keep the
 * last choice inside the component and silently swallow a second attempt with the same parent — exactly the
 * retry a 409 asks for.
 */
const UNSET = ''

/** `root` · `sub` (`parentOrgId` set) · `ไม่ทราบแม่` (neither) — spec "UI behaviour" */
function orgKind(org: BcOrganization): string {
  if (org.isRoot) return 'root'
  return org.parentOrgId ? 'sub' : 'ไม่ทราบแม่'
}

function kindColor(org: BcOrganization): 'primary' | 'neutral' | 'warning' {
  if (org.isRoot) return 'primary'
  return org.parentOrgId ? 'neutral' : 'warning'
}

/** a parent a human picked is marked so nobody wonders why the rule did not produce it */
function kindTitle(org: BcOrganization): string | undefined {
  return org.parentSource === 'human' ? 'ตั้งเอง' : undefined
}

function orgName(org: BcOrganization): string {
  return org.name || REPORT_DASH
}

/** the select only exists while nobody could decide the parent (the rule writes `auto`, a human `human`) */
function needsParent(org: BcOrganization): boolean {
  return !org.isRoot && org.parentOrgId === null && org.parentSource === null
}

function parentItems(): { label: string, value: string }[] {
  return [
    ...roots.value.map(root => ({ label: root.name || `…${root.orgId.slice(-4)}`, value: root.orgId })),
    { label: NO_PARENT_LABEL, value: NO_PARENT_VALUE }
  ]
}

function onParentChange(org: BcOrganization, value: string) {
  emit('set-parent', { org, parentOrgId: value === NO_PARENT_VALUE ? null : value })
}

/**
 * "Syncing…" while a discover job of this account covers the org: either it was started for exactly this org
 * (`runningJob.bcOrgId === orgId`) or it is a whole-login run (`bcOrgId === null`), which fetches every org.
 */
function isSyncing(org: BcOrganization): boolean {
  const job = props.account.runningJob
  if (!job || job.type !== 'discover') return false
  return job.bcOrgId === null || job.bcOrgId === org.orgId
}

function syncedText(org: BcOrganization): string {
  return org.lastDiscoverAt ? timeAgoTh(org.lastDiscoverAt, nowMs.value) : 'ยังไม่เคย'
}

function missingTitle(org: BcOrganization): string {
  return `ไม่เห็นใน BC ตั้งแต่ ${formatDateTime(org.missingSince)}`
}
</script>

<template>
  <!--
    The account table scrolls sideways inside its own `overflow-x-auto` wrapper and is wider than the panel, so
    an expansion that simply filled the cell would push its right-hand controls (the per-org Sync) out of sight.
    `sticky left-0` + a content-sized width keeps the org rows at the left edge of the **visible** area at every
    scroll position, and the mobile cap forces the row to wrap instead of widening the page.
  -->
  <div class="sticky left-0 w-fit min-w-72 max-w-[calc(100vw-4rem)]">
    <div
      v-if="loading"
      class="flex flex-col gap-2 py-1"
      data-testid="ta-org-loading"
      :data-id="account.id"
    >
      <USkeleton class="h-6 w-full" />
      <USkeleton class="h-6 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลด Business Center orgs ไม่สำเร็จ"
      :description="error"
      data-testid="ta-org-error"
      :data-id="account.id"
    >
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          size="xs"
          data-testid="ta-org-retry"
          :data-id="account.id"
          @click="emit('retry')"
        />
      </template>
    </UAlert>

    <p
      v-else-if="orgs.length === 0"
      class="py-2 text-sm text-muted"
      data-testid="ta-org-empty"
      :data-id="account.id"
    >
      ยังไม่เคย Sync
    </p>

    <table
      v-else
      class="block w-full border-separate border-spacing-0 text-sm sm:table sm:w-auto"
      data-testid="ta-orgs"
      :data-id="account.id"
    >
      <tbody class="block sm:table-row-group">
        <tr
          v-for="org in orgs"
          :key="org.orgId"
          class="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 sm:table-row sm:py-0"
          :class="org.missingSince ? 'opacity-60' : ''"
          data-testid="ta-org-row"
          :data-org-id="org.orgId"
          :data-missing="org.missingSince ? '1' : '0'"
          :data-root="org.isRoot ? '1' : '0'"
        >
          <!-- badge + name + copy (+ the unknown-parent chooser); subs are indented one level -->
          <td class="block basis-full border-b border-default py-1 sm:table-cell sm:px-2">
            <!-- a sub is indented one level; the indent lives on the content, not on the cell padding
                 (`sm:px-2` of the cell would win over a `pl-*` utility) -->
            <div class="flex min-w-0 flex-wrap items-center gap-1.5" :class="org.parentOrgId ? 'ps-4' : ''">
              <UBadge
                :color="kindColor(org)"
                variant="subtle"
                size="sm"
                class="whitespace-nowrap"
                :title="kindTitle(org)"
                data-testid="ta-org-kind"
                :data-kind="org.isRoot ? 'root' : org.parentOrgId ? 'sub' : 'unknown'"
                :data-parent-source="org.parentSource ?? ''"
              >
                {{ orgKind(org) }}
              </UBadge>
              <span class="inline-flex min-w-0 items-center gap-0.5">
                <span class="min-w-0 truncate text-highlighted" :title="org.orgId" data-testid="ta-org-name">
                  {{ orgName(org) }} <span class="font-mono text-xs text-muted">…{{ org.orgId.slice(-4) }}</span>
                </span>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Copy BC org id"
                  data-testid="ta-org-copy"
                  :data-org-id="org.orgId"
                  @click="emit('copy', org)"
                />
              </span>
              <UBadge
                v-if="org.missingSince"
                color="neutral"
                variant="outline"
                size="sm"
                icon="i-lucide-eye-off"
                class="whitespace-nowrap"
                :title="missingTitle(org)"
                data-testid="ta-org-missing"
              >
                หาย
              </UBadge>
            </div>

            <div v-if="needsParent(org)" class="mt-1 flex flex-wrap items-center gap-1.5">
              <USelect
                :items="parentItems()"
                :model-value="UNSET"
                :loading="parentBusy === org.orgId"
                :disabled="parentBusy === org.orgId"
                placeholder="เลือก org แม่"
                size="xs"
                class="min-w-40"
                aria-label="org แม่"
                data-testid="ta-org-parent-select"
                :data-org-id="org.orgId"
                @update:model-value="(value: string) => onParentChange(org, value)"
              />
              <span
                v-if="parentErrors?.[org.orgId]"
                class="text-xs text-error"
                data-testid="ta-org-parent-error"
                :data-org-id="org.orgId"
              >
                {{ parentErrors[org.orgId] }}
              </span>
            </div>
          </td>

          <!-- advertisers of this org -->
          <td class="block border-b border-default py-1 sm:table-cell sm:px-2">
            <UButton
              :label="String(org.advertiserCount)"
              icon="i-lucide-building-2"
              color="neutral"
              variant="ghost"
              size="xs"
              class="font-medium tabular-nums"
              :aria-label="`${org.advertiserCount} advertisers — open the list`"
              data-testid="ta-org-adv-count"
              :data-org-id="org.orgId"
              :data-count="org.advertiserCount"
              @click="emit('advertisers', org)"
            />
          </td>

          <!-- last sync of this org + its error -->
          <td class="block border-b border-default py-1 sm:table-cell sm:px-2">
            <span class="flex flex-wrap items-center gap-1">
              <span
                class="whitespace-nowrap text-xs text-muted"
                :title="org.lastDiscoverAt ?? undefined"
                data-testid="ta-org-synced"
                :data-at="org.lastDiscoverAt ?? ''"
              >
                {{ syncedText(org) }}
              </span>
              <UTooltip v-if="org.lastDiscoverError" :text="discoverErrorText(org.lastDiscoverError)">
                <UBadge
                  color="error"
                  variant="subtle"
                  size="sm"
                  icon="i-lucide-triangle-alert"
                  class="whitespace-nowrap"
                  :title="discoverErrorText(org.lastDiscoverError)"
                  data-testid="ta-org-error-chip"
                  :data-error="org.lastDiscoverError"
                >
                  {{ discoverErrorShort(org.lastDiscoverError) }}
                </UBadge>
              </UTooltip>
            </span>
          </td>

          <!-- Sync this org only -->
          <td class="block border-b border-default py-1 text-right sm:table-cell sm:px-2">
            <UTooltip :text="syncBlocked ?? 'Sync advertisers ของ org นี้'">
              <span class="inline-flex">
                <UButton
                  :label="isSyncing(org) ? 'Syncing…' : 'Sync'"
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  :disabled="!!syncBlocked"
                  :loading="syncStarting === org.orgId"
                  data-testid="ta-org-sync"
                  :data-org-id="org.orgId"
                  @click="emit('sync', org)"
                />
              </span>
            </UTooltip>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
