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

import { START_EDIT_TITLE_MESSAGE } from "../../lib/iframe-messages";
import { clampPosition } from "./viewport";

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
    const next = clampPosition(
      dragStart.top + (e.clientY - dragStart.y),
      dragStart.left + (e.clientX - dragStart.x),
      wrapper,
      note.pinned,
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
