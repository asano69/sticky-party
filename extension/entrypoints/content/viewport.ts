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

import type { Anchor } from "../../lib/positions";

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

// Resolves a stored margin ratio (relative to the anchored edge -- see
// lib/positions.ts's Anchor type) back into a top/left pixel offset
// from the start (left/top) edge, given the current basis size
// (document or viewport, matching pin mode) and the note's own size in
// that axis. The decode-side counterpart of closestEdge below.
export function resolveOffset(
  anchor: Anchor,
  marginRatio: number,
  basisSize: number,
  sizePx: number,
): number {
  return anchor === "end"
    ? basisSize - marginRatio * basisSize - sizePx
    : marginRatio * basisSize;
}

// Picks whichever edge (start or end) `offsetPx` currently sits closer
// to along a single axis, and returns that edge plus the note's margin
// from it as a ratio of `basisSize`. Used when persisting a note's
// position, so one dragged flush against the right/bottom edge is
// remembered relative to that edge -- keeping it visually pinned to
// that corner across screens of a different size, instead of always
// being measured from the left/top (see lib/positions.ts's Anchor
// type). The encode-side counterpart of resolveOffset above.
export function closestEdge(
  offsetPx: number,
  sizePx: number,
  basisSize: number,
): [Anchor, number] {
  if (!basisSize) return ["start", 0];
  const distStart = offsetPx;
  const distEnd = basisSize - offsetPx - sizePx;
  return distEnd < distStart
    ? ["end", distEnd / basisSize]
    : ["start", distStart / basisSize];
}

// Clamps a note's top/left so none of its four edges can ever drift
// past the matching edge of the current viewport (offset by scroll
// for a pinned note -- see mountNote.ts's header comment on pin
// modes). Shared by every place that sets top/left directly: the drag
// gesture (noteDragging.ts) and viewport/document-resize
// recomputation (noteViewportTracking.ts) -- without this being
// shared, a note could stay clamped while being dragged but still
// drift off-screen on a window resize, or vice versa.
//
// A note taller or wider than the viewport itself can't satisfy both
// ends of an axis at once -- Math.max(maxTop, offsetY) (and the left
// equivalent) falls back to anchoring the top/left edge to the
// viewport in that case, rather than making the note undraggable.
export function clampPosition(
  top: number,
  left: number,
  wrapper: HTMLElement,
  pinned: boolean,
): { top: number; left: number } {
  const offsetX = pinned ? window.scrollX : 0;
  const offsetY = pinned ? window.scrollY : 0;
  const maxTop = offsetY + window.innerHeight - wrapper.offsetHeight;
  const maxLeft = offsetX + window.innerWidth - wrapper.offsetWidth;
  return {
    top: Math.min(Math.max(top, offsetY), Math.max(maxTop, offsetY)),
    left: Math.min(Math.max(left, offsetX), Math.max(maxLeft, offsetX)),
  };
}
