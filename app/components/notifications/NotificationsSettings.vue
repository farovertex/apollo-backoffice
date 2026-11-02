<script setup lang="ts">
/**
 * FEAT-095 (spec "UI behaviour", AC-19) — the two per-admin switches, shared by the slideover gear popover.
 * Optimistic flip handled by `useNotifications().setPref` (one PATCH with only the changed key, revert + error
 * toast on failure). The UserMenu uses its own checkbox items bound to the same composable.
 */
const { prefs, setPref } = useNotifications()
</script>

<template>
  <div class="flex min-w-56 flex-col gap-3 p-1" data-testid="nt-settings">
    <USwitch
      :model-value="prefs.notifyToast"
      label="เด้ง toast แจ้งเตือน"
      :disabled="!prefs.loaded"
      data-testid="nt-pref-toast"
      @update:model-value="(v: boolean) => setPref('notifyToast', v)"
    />
    <USwitch
      :model-value="prefs.notifySound"
      label="เสียงแจ้งเตือน"
      :disabled="!prefs.loaded"
      data-testid="nt-pref-sound"
      @update:model-value="(v: boolean) => setPref('notifySound', v)"
    />
  </div>
</template>
