// Wires the native CSS `resize: both` handle on a note's wrapper to
// contentHeightPx + persistPosition. The handle is implemented by the
// browser itself and fires no dedicated resize-start/resize-end
// event, so a ResizeObserver is used as the trigger instead (debounced
// so a drag doesn't spam writes), and the end of the gesture is
// detected via a window pointerup/pointercancel -- with a fallback
// timer, since Chrome's pointerup for this handle sometimes never
// reaches window (e.g. released outside the viewport).

import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";

const RESIZE_END_FALLBACK_MS = 500;

export interface NoteResizeState {
  // Whether a resize gesture is currently in progress. Read by
  // mountNote.ts's applyRemotePosition to ignore incoming remote
  // updates mid-gesture -- see mountNote.ts's header comment.
  isResizing: () => boolean;
  cleanup: () => void;
}

export function wireResizing(params: {
  wrapper: HTMLElement;
  note: { editing: boolean };
  setNote: (patch: { contentHeightPx: number }) => void;
  persistPosition: () => void;
}): NoteResizeState {
  const { wrapper, note, setNote, persistPosition } = params;

  let resizing = false;
  // First observation always fires on mount, which isn't a real
  // resize -- skipped so it never triggers a spurious save.
  let skipNextResizeSave = true;
  let resizePointerUpListener: ((e: PointerEvent) => void) | undefined;
  // Fallback for resizePointerUpListener: sometimes the native resize
  // handle's pointerup never reaches window -- without a fallback,
  // `resizing` would then stay true forever, permanently ignoring
  // every future remote position update for this note. Reset on every
  // ResizeObserver callback; if it ever fires, the gesture is treated
  // as finished even though no pointerup was seen.
  let resizeEndTimer: ReturnType<typeof setTimeout> | undefined;

  const resizeObserver = new ResizeObserver(() => {
    if (skipNextResizeSave) {
      skipNextResizeSave = false;
      return;
    }
    // Re-derive contentHeightPx from the wrapper's actual size, so a
    // manual drag-resize (which sets the wrapper's height directly,
    // bypassing the note store's effect in mountNote.ts) updates what
    // gets persisted -- minus the edit-mode footer, if currently
    // editing, so the resting size stays footer-free either way.
    const footer = note.editing ? TITLE_ROW_HEIGHT_PX : 0;
    setNote({
      contentHeightPx: Math.max(
        0,
        wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX - footer,
      ),
    });

    // Ends the current resize gesture exactly once, however it was
    // detected (pointerup/pointercancel, or the fallback timer below)
    // -- guarded so a pointerup arriving right as the fallback timer
    // also fires can't run this twice.
    const endResize = () => {
      if (!resizing) return;
      resizing = false;
      if (resizePointerUpListener) {
        window.removeEventListener("pointerup", resizePointerUpListener);
        window.removeEventListener("pointercancel", resizePointerUpListener);
        resizePointerUpListener = undefined;
      }
      clearTimeout(resizeEndTimer);
      resizeEndTimer = undefined;
      persistPosition();
    };

    // Every observed change (including the first) pushes the fallback
    // timer back out, so it only fires once the resize has actually
    // gone quiet.
    clearTimeout(resizeEndTimer);
    resizeEndTimer = setTimeout(endResize, RESIZE_END_FALLBACK_MS);

    if (resizing) return; // already waiting for this gesture to end

    // First observed change of a new resize gesture: nothing is sent
    // to the backend yet. Instead, wait for the native resize
    // handle's pointer to be released -- CSS `resize: both` is
    // handled entirely by the browser, so there is no
    // resize-start/resize-end event to listen to directly.
    resizing = true;
    resizePointerUpListener = endResize;
    window.addEventListener("pointerup", resizePointerUpListener);
    window.addEventListener("pointercancel", resizePointerUpListener);
  });
  resizeObserver.observe(wrapper);

  return {
    isResizing: () => resizing,
    cleanup: () => {
      resizeObserver.disconnect();
      if (resizePointerUpListener) {
        window.removeEventListener("pointerup", resizePointerUpListener);
        window.removeEventListener("pointercancel", resizePointerUpListener);
      }
      clearTimeout(resizeEndTimer);
    },
  };
}
