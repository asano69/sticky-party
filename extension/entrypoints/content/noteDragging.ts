// Wires the drag-to-move gesture and the double-click-to-edit-title
// relay onto a note's transparent header overlay (see mountNote.ts's
// header comment for why the header exists at all, and
// entrypoints/content/index.ts's header comment for why the title
// text itself lives in the iframe rather than here). Dragging is
// tracked entirely in this document (never inside the iframe), so
// pointer capture keeps working even if the cursor briefly outruns
// the note during a fast drag -- an iframe boundary would otherwise
// interrupt it.
//
// No cleanup is returned here: the header dies along with the
// wrapper element when the note is removed (see mountNote.ts's
// onRemove), so these listeners never need explicit teardown.

import {
  START_EDIT_TITLE_MESSAGE,
  TITLE_ROW_HEIGHT_PX,
} from "../../lib/iframe-messages";

export interface NoteDragState {
  // Whether a drag gesture is currently in progress. Read by
  // mountNote.ts's applyRemotePosition to ignore incoming remote
  // updates mid-gesture (including this client's own self-echoed
  // save) -- see mountNote.ts's header comment.
  isDragging: () => boolean;
}

export function wireDragging(params: {
  header: HTMLElement;
  wrapper: HTMLElement;
  iframe: HTMLIFrameElement;
  iframeOrigin: string;
  note: { top: number; left: number; pinned: boolean };
  setNote: (patch: { top: number; left: number }) => void;
  bringToFront: () => void;
  persistPosition: () => void;
}): NoteDragState {
  const {
    header,
    wrapper,
    iframe,
    iframeOrigin,
    note,
    setNote,
    bringToFront,
    persistPosition,
  } = params;

  let dragging = false;
  let dragStart: { x: number; y: number; top: number; left: number } | null =
    null;

  // Keeps the header row draggable within the currently visible area,
  // so it can never be dragged out where the user could no longer
  // grab it. Clamped against the viewport either way: even a pinned
  // (position: absolute) note is being dragged relative to what the
  // user can currently see, so the bound is the visible viewport
  // shifted by the current scroll offset, not the whole document.
  //
  // Only the header's minimum horizontal visibility is enforced
  // (MIN_VISIBLE_PX), not the whole note width -- a note can be wider
  // than the viewport itself, so requiring full horizontal visibility
  // would make it impossible to drag at all in that case. Vertically
  // the full header height is enforced since that's fixed at
  // TITLE_ROW_HEIGHT_PX regardless of note width.
  const MIN_VISIBLE_PX = 40;
  const clampDragPosition = (nextTop: number, nextLeft: number) => {
    const offsetX = note.pinned ? window.scrollX : 0;
    const offsetY = note.pinned ? window.scrollY : 0;
    const maxTop = offsetY + window.innerHeight - TITLE_ROW_HEIGHT_PX;
    const minLeft = offsetX - (wrapper.offsetWidth - MIN_VISIBLE_PX);
    const maxLeft = offsetX + window.innerWidth - MIN_VISIBLE_PX;
    return {
      top: Math.min(Math.max(nextTop, offsetY), Math.max(maxTop, offsetY)),
      left: Math.min(Math.max(nextLeft, minLeft), Math.max(maxLeft, minLeft)),
    };
  };

  header.addEventListener("pointerdown", (e) => {
    // Skip drag/capture when the pointerdown landed on the Dismiss
    // button: setPointerCapture below redirects all subsequent
    // pointer events (including the click derived from pointerup) to
    // the header, which otherwise silently swallows the button's own
    // click handler.
    if ((e.target as HTMLElement).closest("button")) return;
    dragging = true;
    bringToFront();
    dragStart = {
      x: e.clientX,
      y: e.clientY,
      top: note.top,
      left: note.left,
    };
    header.setPointerCapture(e.pointerId);
  });

  header.addEventListener("pointermove", (e) => {
    if (!dragStart) return;
    const next = clampDragPosition(
      dragStart.top + (e.clientY - dragStart.y),
      dragStart.left + (e.clientX - dragStart.x),
    );
    setNote({ top: next.top, left: next.left });
  });

  const endDrag = () => {
    if (!dragStart) return;
    dragStart = null;
    dragging = false;
    persistPosition();
  };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  // Double-clicking the header outside the Dismiss button edits the
  // title. The title text itself lives inside the iframe (see
  // entrypoints/content/index.ts's header comment), so this only
  // relays the gesture -- NoteContent.tsx does the actual editing.
  header.addEventListener("dblclick", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    iframe.contentWindow?.postMessage(
      { type: START_EDIT_TITLE_MESSAGE },
      iframeOrigin,
    );
  });

  return { isDragging: () => dragging };
}
