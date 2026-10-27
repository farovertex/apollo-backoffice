/**
 * FEAT-069 — client-side column sort of the `/reports/performance` tables (spec AC-20): a click on the active
 * column flips the direction, a click on another column sorts it descending first (to-the-mars `useSort`).
 */
export function usePerfSort<C extends string>(initial: C, initialDir: 1 | -1 = -1) {
  const col = ref<C>(initial) as Ref<C>
  const dir = ref<1 | -1>(initialDir)

  function toggle(next: C) {
    if (col.value === next) {
      dir.value = dir.value === 1 ? -1 : 1
    } else {
      col.value = next
      dir.value = -1
    }
  }

  function ariaSort(c: C) {
    return perfAriaSort(col.value === c, dir.value)
  }

  return { col, dir, toggle, ariaSort }
}
