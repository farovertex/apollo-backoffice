<script setup lang="ts">
/**
 * TASK-post-report-drift (finding E, 2026-11-01 db audit) — `rp-shared-utm`: a UTM key is per prefix campaign,
 * not per post (10 keys cover 536 builds in the audit); whenever `money.sharedUtm.withOthers > 0` the
 * Deposit/Dep-Budget/Cost-Dep number next to this badge is the **whole key's** number, shared with that many
 * other rows/builds in the same cohort — not this row's own money. Shown next to the Deposit value wherever
 * `Table.vue` / `LayerCards.vue` print it (api-contract.md v1.2, `PostReportSharedUtm`).
 */
const props = defineProps<{ withOthers: number }>()

const title = computed(() => sharedUtmTooltip(props.withOthers))
</script>

<template>
  <UBadge
    color="warning"
    variant="subtle"
    size="sm"
    data-testid="rp-shared-utm"
    :title="title"
  >
    แชร์ key
  </UBadge>
</template>
