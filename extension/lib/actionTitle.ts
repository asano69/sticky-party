// Formats the browser action's hover-tooltip title text. Shared by
// App.tsx (global default title -- no per-page numerator, since the
// popup itself isn't tied to any particular tab) and background.ts
// (per-tab title, with a numerator once that page's note count is
// known -- see lib/annotationCountCache.ts for where the denominator
// comes from).

export function formatActionTitle(total?: number, current?: number): string {
  if (total === undefined) return "Sticky Party";
  if (current !== undefined && current > 0) {
    return `Sticky Party (${current}/${total})`;
  }
  return `Sticky Party (${total})`;
}
