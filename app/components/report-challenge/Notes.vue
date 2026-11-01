<script setup lang="ts">
/**
 * FEAT-094 — the footnote of `/reports/challenge` (spec "UI behaviour" → ท้ายหน้า): the definitions sentence
 * plus the shared `MoneyNote` fx caption (same pattern as the other report pages, FEAT-084).
 */
import type { FxReportBlock } from '#shared/types/fx'

defineProps<{
  fx: FxReportBlock | null | undefined
}>()

const NOTE = 'ยิงไป = spend TikTok (THB) · ได้ยอด = ยอดฝากจาก UTM ของ key ที่คนนั้นเป็นเจ้าของ · คุ้ม = ได้ยอด ÷ ยิงไป (Dep/Budget) · จุดเขียว = ส่งอยู่ · เหลือง = ไม่ส่ง · เทา = ไม่ทราบ · Top 3 = โฆษณาที่ conversions สูงสุดของช่วง (ยอดฝากแยกต่อโฆษณาไม่ได้) · ลูกศร = เทียบช่วงก่อนหน้าที่ยาวเท่ากัน'
</script>

<template>
  <div class="flex flex-col gap-2">
    <p data-testid="rc-notes" class="text-xs text-muted">
      {{ NOTE }}
    </p>
    <MoneyNote mode="thb" :fx="fx" class="self-start" />
  </div>
</template>
