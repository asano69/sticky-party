// Document size and rem/px conversion helpers. Extracted from
// content.ts so this measurement logic stays separate from the
// per-note DOM lifecycle logic (see ./mountNote.ts).
//
// Position is now shared across every viewer (see lib/positions.ts),
// stored as a ratio of the whole document -- not the viewport -- so
// there is no more per-window rescaling to do here: every note's
// top/left is simply re-derived from its stored ratio whenever the
// document's size changes (see mountNote.ts's docResizeObserver).

// The whole document's size in CSS px. Every note's x/y ratio (see
// lib/positions.ts) is relative to this.
export function documentSize(): { width: number; height: number } {
  const el = document.documentElement;
  return { width: el.scrollWidth, height: el.scrollHeight };
}

// Converts between rem (the unit positions are stored in -- see
// lib/positions.ts) and px (the unit the DOM actually needs), using
// the host page's own root font size. Read fresh each time rather than
// cached, since the host page's CSS could change it at any point.
function rootFontSizePx(): number {
  return parseFloat(getComputedStyle(document.documentElement).fontSize);
}
export function remToPx(rem: number): number {
  return rem * rootFontSizePx();
}
export function pxToRem(px: number): number {
  return px / rootFontSizePx();
}
