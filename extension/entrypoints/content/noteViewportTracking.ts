// Keeps a note's on-screen position following its persisted ratio
// (see notePosition.ts's PositionRatioState) as the ratio's basis
// changes -- the whole document for a pinned note, the current
// viewport for an unpinned one (see mountNote.ts's header comment for
// why the basis differs by pin mode). Document size can shift as
// images, web fonts, or lazily-mounted content change the page's
// layout; viewport size changes on an ordinary browser window resize.
// Both are watched, debounced, so a note never drifts outside the
// visible area regardless of pin mode.

import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";
import {
  clampToBasis,
  documentSize,
  resolveOffset,
  viewportSize,
} from "./viewport";
import type { PositionRatioState } from "./notePosition";

const RECOMPUTE_DEBOUNCE_MS = 300;

export interface NoteViewportTrackingState {
  cleanup: () => void;
}

export function wireViewportTracking(params: {
  ratioState: PositionRatioState;
  wrapper: HTMLElement;
  note: { pinned: boolean; previewHeightPx: number };
  setNote: (patch: { top: number; left: number }) => void;
}): NoteViewportTrackingState {
  const { ratioState, wrapper, note, setNote } = params;

  const recomputePosition = () => {
    const basis = note.pinned ? documentSize() : viewportSize();
    // Same as before: this doesn't add the edit-mode footer even
    // while editing -- non-interactive repositioning always works off
    // the note's resting (view-mode) size.
    const heightPx = TITLE_ROW_HEIGHT_PX + note.previewHeightPx;
    const top = resolveOffset(
      ratioState.anchorY,
      ratioState.yRatio,
      basis.height,
      heightPx,
    );
    const left = resolveOffset(
      ratioState.anchorX,
      ratioState.xRatio,
      basis.width,
      wrapper.offsetWidth,
    );
    // A window/document resize can shrink the basis enough that the
    // ratio-derived position now falls outside it (e.g. a note
    // anchored near the right edge on a wide screen, viewed again on
    // a narrow one) -- clamp against the basis itself (clampToBasis),
    // not the currently scrolled-into-view region (clampPosition):
    // this runs non-interactively, including once immediately on
    // mount (ResizeObserver always fires on initial observe), so it
    // must not depend on wherever the page happens to be scrolled to
    // at that moment -- see clampToBasis's comment in viewport.ts.
    setNote(clampToBasis(top, left, wrapper, basis));
  };

  let docResizeTimer: ReturnType<typeof setTimeout> | undefined;
  const docResizeObserver = new ResizeObserver(() => {
    clearTimeout(docResizeTimer);
    docResizeTimer = setTimeout(recomputePosition, RECOMPUTE_DEBOUNCE_MS);
  });
  // Observes document.body, not document.documentElement: per the
  // CSSOM View spec's root-element special case (the same one behind
  // documentElement.clientHeight always reporting the viewport size
  // rather than the element's own box), browsers apply the same
  // special case to ResizeObserver's content-box for <html> -- it
  // tracks the viewport, not the page's actual scrollable height. That
  // means it never fires as below-the-fold content (lazy images,
  // infinite scroll, etc.) finishes loading in, so a pinned note's
  // wrong initial position -- computed from an incompletely-loaded
  // documentSize() in notePosition.ts right after a mid-page reload --
  // never gets corrected. document.body has no such special case and
  // grows with its content like any other element, so it reliably
  // reports when the page's real height changes.
  docResizeObserver.observe(document.body);

  const onWindowResize = () => {
    clearTimeout(docResizeTimer);
    docResizeTimer = setTimeout(recomputePosition, RECOMPUTE_DEBOUNCE_MS);
  };
  window.addEventListener("resize", onWindowResize);

  return {
    cleanup: () => {
      docResizeObserver.disconnect();
      clearTimeout(docResizeTimer);
      window.removeEventListener("resize", onWindowResize);
    },
  };
}
