// Fetches and persists a note's shared position/size/pin/z (see
// lib/positions.ts) via the background script -- a content script
// can't safely call PocketBase directly (see lib/messages.ts's header
// comment). Position is shared across every viewer: x/y are ratios of
// either the whole document (pinned) or the current viewport
// (unpinned), width/height are stored in rem. See mountNote.ts's
// header comment for why the ratio's basis depends on pin mode.

import {
  GET_POSITION_MESSAGE,
  SAVE_POSITION_MESSAGE,
  type GetPositionMessage,
  type SavePositionMessage,
} from "../../lib/messages";
import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";
import type { Anchor, StoredPosition } from "../../lib/positions";
import {
  closestEdge,
  documentSize,
  pxToRem,
  remToPx,
  resolveOffset,
  viewportSize,
} from "./viewport";
import { log } from "../../lib/log";

// This note's anchor, as a ratio of the whole document or the current
// viewport (depending on pin mode) -- the source of truth for
// top/left regardless of pin mode. Deliberately not part of the
// reactive `note` store in mountNote.ts: it's the persisted-ratio side
// of this note's position, a separate concern from what the store
// renders (the current pixel position for the current basis).
// Mutated in place by createPersistPosition and by
// noteViewportTracking.ts's recomputePosition, and read by
// mountNote.ts's applyRemotePosition.
export interface PositionRatioState {
  xRatio: number;
  yRatio: number;
  // Which edge x/y are each measured from -- see lib/positions.ts's
  // Anchor type.
  anchorX: Anchor;
  anchorY: Anchor;
  positionRecordId?: string;
}

export interface InitialPosition {
  top: number;
  left: number;
  z: number;
  pinned: boolean;
  ratioState: PositionRatioState;
  widthPx?: number;
  // View-mode (preview) content height, restored from the saved
  // `height` field, or 0 for a brand-new note -- see
  // docs/note-sizing.md.
  previewHeightPx: number;
  // Edit-mode content height (including the footer), restored from
  // the saved `editorHeight` field, or 0 for a note that has never
  // been edited yet.
  editorHeightPx: number;
  // Whether the preview height should keep auto-following the
  // content's natural size. Defaults to true for a note with no saved
  // value yet.
  autoHeight: boolean;
}

// Fetches this annotation's saved position, if any, falling back to a
// cascade default (cascadeTop/cascadeLeft) for a brand-new note.
export async function fetchInitialPosition(params: {
  annotationId: string;
  cascadeTop: number;
  cascadeLeft: number;
  nextZ: () => number;
  bumpZCounter: (z: number) => void;
}): Promise<InitialPosition> {
  const { annotationId, cascadeTop, cascadeLeft, nextZ, bumpZCounter } = params;

  let top = cascadeTop;
  let left = cascadeLeft;
  let z: number;
  let pinned = false;
  let positionRecordId: string | undefined;
  let widthPx: number | undefined;
  let heightPx: number | undefined;
  let editorHeightPx = 0;
  let autoHeight = true;
  let xRatio = 0;
  let yRatio = 0;
  // Default anchor for a brand-new note (no saved position yet) --
  // always measured from the top-left, matching the old unconditional
  // left/top semantics.
  let anchorX: Anchor = "start";
  let anchorY: Anchor = "start";

  try {
    const saved: StoredPosition | undefined = await browser.runtime.sendMessage(
      {
        type: GET_POSITION_MESSAGE,
        annotationId,
      } satisfies GetPositionMessage,
    );
    if (saved) {
      positionRecordId = saved.id;
      pinned = saved.pin;
      xRatio = saved.x;
      yRatio = saved.y;
      anchorX = saved.anchorX;
      anchorY = saved.anchorY;
      widthPx = remToPx(saved.width);
      heightPx = remToPx(saved.height);
      // `editorHeight`/`autoHeight` may be missing on records saved
      // before these fields existed; fall back to "never edited yet"
      // (0) and "still auto-sizing" (true) respectively.
      editorHeightPx = saved.editorHeight
        ? Math.max(0, remToPx(saved.editorHeight) - TITLE_ROW_HEIGHT_PX)
        : 0;
      autoHeight = saved.autoHeight ?? true;
      // Basis matches this note's pin mode -- see mountNote.ts's
      // header comment.
      const basis = pinned ? documentSize() : viewportSize();
      top = resolveOffset(anchorY, saved.y, basis.height, heightPx);
      left = resolveOffset(anchorX, saved.x, basis.width, widthPx);
      z = saved.z;
      bumpZCounter(z);
    } else {
      z = nextZ();
    }
  } catch (err) {
    log.error("failed to load position", { err });
    z = nextZ();
  }

  if (positionRecordId === undefined) {
    // No saved position: derive the initial ratio from the cascade
    // default so persistPosition/recomputePosition have a sane anchor
    // to work from until the first real save. A brand-new note is
    // never pinned yet, so this always uses the viewport basis, and
    // always the top-left edges (anchorX/anchorY default above).
    const basis = viewportSize();
    xRatio = basis.width ? left / basis.width : 0;
    yRatio = basis.height ? top / basis.height : 0;
  }

  return {
    top,
    left,
    z,
    pinned,
    ratioState: { xRatio, yRatio, anchorX, anchorY, positionRecordId },
    widthPx,
    previewHeightPx: heightPx
      ? Math.max(0, heightPx - TITLE_ROW_HEIGHT_PX)
      : 0,
    editorHeightPx,
    autoHeight,
  };
}

// Saves the shared position/size/pin/z for an annotation, computing
// xRatio/yRatio fresh from the note's current top/left before sending
// -- this is the one place a note's anchor is actually redefined (e.g.
// after a drag), so noteViewportTracking.ts's recomputePosition always
// works from up-to-date values.
export function createPersistPosition(params: {
  annotationId: string;
  wrapper: HTMLElement;
  ratioState: PositionRatioState;
  note: {
    pinned: boolean;
    top: number;
    left: number;
    z: number;
    previewHeightPx: number;
    editorHeightPx: number;
    autoHeight: boolean;
  };
}): () => void {
  const { annotationId, wrapper, ratioState, note } = params;

  return () => {
    const basis = note.pinned ? documentSize() : viewportSize();
    const widthPx = wrapper.offsetWidth;
    // Use previewHeightPx (the resting/non-editing size), not
    // wrapper.offsetHeight -- the wrapper is temporarily taller than
    // that while editing (see mountNote.ts's note-store effect).
    const heightPx = TITLE_ROW_HEIGHT_PX + note.previewHeightPx;

    // Picks whichever edge each axis currently sits closer to, so a
    // note dragged flush against the right/bottom edge is remembered
    // relative to that edge instead of always the left/top -- see
    // lib/positions.ts's Anchor type.
    const [anchorX, xRatio] = closestEdge(note.left, widthPx, basis.width);
    const [anchorY, yRatio] = closestEdge(note.top, heightPx, basis.height);
    ratioState.anchorX = anchorX;
    ratioState.xRatio = xRatio;
    ratioState.anchorY = anchorY;
    ratioState.yRatio = yRatio;

    browser.runtime
      .sendMessage({
        type: SAVE_POSITION_MESSAGE,
        annotationId,
        position: {
          pin: note.pinned,
          anchorX,
          anchorY,
          x: xRatio,
          y: yRatio,
          width: pxToRem(widthPx),
          height: pxToRem(heightPx),
          editorHeight: pxToRem(TITLE_ROW_HEIGHT_PX + note.editorHeightPx),
          autoHeight: note.autoHeight,
          z: note.z,
        },
        existingId: ratioState.positionRecordId,
      } satisfies SavePositionMessage)
      .then((id: string) => (ratioState.positionRecordId = id))
      .catch((err: unknown) => log.error("failed to save position", { err }));
  };
}
