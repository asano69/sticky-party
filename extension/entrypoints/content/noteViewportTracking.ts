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
  clampPosition,
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
  note: { pinned: boolean; contentHeightPx: number };
  setNote: (patch: { top: number; left: number }) => void;
}): NoteViewportTrackingState {
  const { ratioState, wrapper, note, setNote } = params;

  const recomputePosition = () => {
    const basis = note.pinned ? documentSize() : viewportSize();
    const heightPx = TITLE_ROW_HEIGHT_PX + note.contentHeightPx;
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
    // ratio-derived position now falls outside the new viewport (e.g.
    // a note anchored near the right edge on a wide screen, viewed
    // again on a narrow one) -- clamp the same way drag does (see
    // noteDragging.ts), so the note never ends up stuck off any edge.
    setNote(clampPosition(top, left, wrapper, note.pinned));
  };

  let docResizeTimer: ReturnType<typeof setTimeout> | undefined;
  const docResizeObserver = new ResizeObserver(() => {
    clearTimeout(docResizeTimer);
    docResizeTimer = setTimeout(recomputePosition, RECOMPUTE_DEBOUNCE_MS);
  });
  docResizeObserver.observe(document.documentElement);

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
