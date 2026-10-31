<script setup lang="ts">
/**
 * FEAT-089 — `rp-head` of `/reports/posts/:key` (spec "UI behaviour → /reports/posts/:key"): cover 96×128,
 * title/subtitle, template/prefix chips, "ดูใน Ads monitor" (disabled when there is no campaign to open) and
 * "Duplicate template" (`adTemplate` lens, existing template only).
 *
 * A15 (spec Assumptions) — there is no `?duplicate=<id>` entry point on `/ad-templates` (it reads no query
 * param at all, confirmed by reading the page): the button links to `/ad-templates?q=<name>` instead, which
 * does not pre-fill the search either (local `ref`, not URL-bound) but lands the admin on the right page with
 * the name visible in the title to type into the search box themselves. Documented in `bo.md` for the Lead.
 */
import type { PostReportLens, PostReportRow } from '#shared/types/report-posts'

const props = defineProps<{
  row: PostReportRow
  by: PostReportLens
  prefixes: string[]
  monitorCampaignId: string | null
}>()

const monitorLink = computed(() => (props.monitorCampaignId ? `/ads-monitor?campaignId=${encodeURIComponent(props.monitorCampaignId)}` : null))
const canDuplicate = computed(() => props.by === 'adTemplate' && props.row.subject.exists === true)
const duplicateLink = computed(() => `/ad-templates?q=${encodeURIComponent(props.row.subject.title)}`)
</script>

<template>
  <section class="flex flex-col gap-3 rounded-lg border border-default p-3 sm:flex-row sm:items-start" data-testid="rp-head">
    <ReportPostsCover
      :url="row.subject.coverUrl"
      :is-video="row.subject.isVideo"
      :kind="row.subject.kind"
      size="lg"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-2">
      <div>
        <h1 class="truncate text-lg font-semibold text-highlighted" data-testid="rp-head-title">
          {{ row.subject.title }}
        </h1>
        <p class="truncate text-sm text-muted" data-testid="rp-head-subtitle">
          {{ row.subject.subtitle }}
        </p>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UBadge
          v-for="t in row.subject.templates"
          :key="t.id"
          color="neutral"
          variant="subtle"
          size="sm"
          data-testid="rp-chip-template"
        >
          {{ t.name }}
        </UBadge>
        <span v-if="row.subject.templatesMore > 0" class="text-xs text-dimmed">+{{ row.subject.templatesMore }} เพิ่มเติม</span>
        <UBadge
          v-for="p in prefixes"
          :key="p"
          color="primary"
          variant="subtle"
          size="sm"
          data-testid="rp-chip-prefix"
        >
          {{ p }}
        </UBadge>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          label="ดูใน Ads monitor"
          icon="i-lucide-monitor"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="!monitorLink"
          :to="monitorLink ?? undefined"
          data-testid="rp-open-monitor"
        />
        <UButton
          v-if="canDuplicate"
          label="Duplicate template"
          icon="i-lucide-copy"
          color="neutral"
          variant="outline"
          size="sm"
          :to="duplicateLink"
          data-testid="rp-duplicate"
        />
      </div>
    </div>
  </section>
</template>
