<script setup lang="ts">
/**
 * FEAT-089 — `rp-reasons` of `/reports/posts/:key` (spec "UI behaviour → /reports/posts/:key"): rejection
 * reasons sorted count desc, each with the ad templates it was seen on (≤ 5 names, contract §3).
 */
import type { PostReportReason } from '#shared/types/report-posts'

defineProps<{ reasons: PostReportReason[] }>()
</script>

<template>
  <section class="flex flex-col gap-2 rounded-lg border border-default p-3" data-testid="rp-reasons">
    <h2 class="text-sm font-semibold text-highlighted">
      เหตุผลที่ถูกปฏิเสธ
    </h2>
    <p v-if="reasons.length === 0" class="text-sm text-muted" data-testid="rp-reasons-empty">
      ไม่มี build ที่ถูกปฏิเสธในช่วงนี้
    </p>
    <ul v-else class="flex flex-col gap-1.5">
      <li
        v-for="r in reasons"
        :key="r.label"
        class="flex flex-col gap-0.5 border-b border-default/60 pb-1.5 last:border-b-0 last:pb-0"
        data-testid="rp-reason"
      >
        <span class="flex items-center justify-between gap-2 text-sm">
          <span class="truncate text-highlighted">{{ r.label }}</span>
          <UBadge color="error" variant="subtle" size="sm">{{ formatInt(r.count) }}</UBadge>
        </span>
        <span v-if="r.templates.length > 0" class="truncate text-xs text-muted">
          {{ r.templates.join(', ') }}
        </span>
      </li>
    </ul>
  </section>
</template>
