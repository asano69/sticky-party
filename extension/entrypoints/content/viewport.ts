// Viewport/document size helpers and the shared resize-repositioning
// registry. Extracted from content.ts so viewport measurement stays
// separate from the per-note DOM lifecycle logic (see ./index.ts).

import type { ViewportInfo } from "../../lib/positions";

// The layout viewport's width/height in CSS px, preferring
// window.visualViewport over window.innerWidth/innerHeight. The two
// normally agree, but visualViewport reports sub-pixel float values
// while innerWidth/innerHeight are integers -- at some zoom levels that
// rounding alone is enough for the position ratio math below to drift
// after repeated zoom changes. visualViewport also fires its own
// 'resize' event on pinch-zoom, which the plain window 'resize' event
// doesn't always cover. Falls back to innerWidth/innerHeight for older
// browsers without visualViewport support.
export function viewportSize(): { width: number; height: number } {
  const vv = window.visualViewport;
  return vv
    ? { width: vv.width, height: vv.height }
    : { width: window.innerWidth, height: window.innerHeight };
}

// The content page's own viewport at the moment of the call, read
// fresh each time rather than cached -- lib/positions.ts needs this
// because it runs in the background script (see that file's header
// comment), which has no access to the content page's real `window`.
export function currentViewport(): ViewportInfo {
  const { width, height } = viewportSize();
  return {
    windowWidth: width,
    windowHeight: height,
  };
}

// The whole document's size in CSS px, used for pinned notes' ratio
// math (see persistPosition/togglePin in ./index.ts). Unlike
// viewportSize, this isn't clamped to the visible area -- a pinned note
// anchors to a point in the whole document, not just the window.
export function documentSize(): { width: number; height: number } {
  const el = document.documentElement;
  return { width: el.scrollWidth, height: el.scrollHeight };
}

// Notes render at raw pixel offsets, but their saved position is a
// ratio of the window's size (see lib/positions.ts's toRatio), so a
// manual browser resize should keep each note in the same relative
// spot instead of leaving it pinned to its old pixel offset. Rescaling
// top/left by the window's size delta on every resize keeps
// position/windowSize constant -- equivalent to reapplying the
// original saved ratio -- so no DB round trip is needed here.
//
// Returns the registry Set itself: callers (mountNote) add/delete their
// own reposition callback directly, so this factory doesn't need to
// expose separate subscribe/unsubscribe functions.
export function createResizeRegistry(): Set<
  (scaleX: number, scaleY: number) => void
> {
  const registered = new Set<(scaleX: number, scaleY: number) => void>();

  let prevViewport = viewportSize();

  const onViewportResize = () => {
    const next = viewportSize();
    const scaleX = next.width / prevViewport.width;
    const scaleY = next.height / prevViewport.height;

    prevViewport = next;

    for (const reposition of registered) {
      reposition(scaleX, scaleY);
    }
  };

  // Both listeners are registered: window 'resize' covers ordinary
  // window resizing, and visualViewport 'resize' covers zoom changes
  // (page zoom and pinch-zoom) that don't always fire window 'resize'.
  window.addEventListener("resize", onViewportResize);
  window.visualViewport?.addEventListener("resize", onViewportResize);

  return registered;
}
