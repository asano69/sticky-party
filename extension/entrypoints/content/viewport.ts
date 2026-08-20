// Document/viewport size and rem/px conversion helpers. Extracted
// from content.ts so this measurement logic stays separate from the
// per-note DOM lifecycle logic (see ./mountNote.ts).
//
// Position is shared across every viewer (see lib/positions.ts),
// stored as a ratio -- but the ratio's basis depends on pin mode: the
// whole document for a pinned note (position: absolute), the current
// viewport for an unpinned note (position: fixed), matching how the
// browser actually anchors each mode. Every note's top/left is
// re-derived from its stored ratio and the appropriate basis whenever
// that basis's size changes (see mountNote.ts's recomputePosition).

// The whole document's size in CSS px. Used as the ratio basis for a
// pinned note (see lib/positions.ts).
export function documentSize(): { width: number; height: number } {
  const el = document.documentElement;
  return { width: el.scrollWidth, height: el.scrollHeight };
}

// The current browser viewport's size in CSS px. Used as the ratio
// basis for an unpinned note (position: fixed), which the browser
// anchors to the viewport regardless of scroll -- basing it on the
// document's (often much larger) size instead could place the note's
// header outside the viewport on many resolutions, with no way to
// drag it back into view.
export function viewportSize(): { width: number; height: number } {
  return { width: window.innerWidth, height: window.innerHeight };
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
