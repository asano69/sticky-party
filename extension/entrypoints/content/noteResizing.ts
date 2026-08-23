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
  // Returns the height (px) mountNote.ts's own style effect most
  // recently applied to wrapper.style.height. Comparing the wrapper's
  // actual offsetHeight against this snapshot -- instead of
  // recomputing an "expected" height from note.editing/editorHeightPx/
  // previewHeightPx here -- means a resize is only ever flagged when
  // the wrapper's size diverges from what this module itself last
  // caused. A brief inconsistency between those store fields (e.g.
  // NOTE_EDITING_MESSAGE and NOTE_CONTENT_RESIZE_MESSAGE arriving as
  // two separate postMessage calls right as an edit ends) can then
  // never be mistaken for a manual drag -- see docs/note-sizing.md.
  getExpectedHeightPx: () => number;
  setNote: (patch: {
    previewHeightPx?: number;
    editorHeightPx?: number;
    autoHeight?: boolean;
  }) => void;
  persistPosition: () => void;
}): NoteResizeState {
  const { wrapper, note, getExpectedHeightPx, setNote, persistPosition } =
    params;

  let resizing = false;
  // First observation always fires on mount, which isn't a real
  // resize -- skipped so it never triggers a spurious save.
  let skipNextResizeSave = true;
  // Tracks the wrapper's own width across observations, so a
  // programmatic height-only change (see heightMatchesStore below)
  // can be told apart from a genuine drag on the native resize
  // handle, which always changes width too (resize: both).
  let lastWidthPx = wrapper.offsetWidth;
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
      lastWidthPx = wrapper.offsetWidth;
      return;
    }

    // The note store's own effect (mountNote.ts) also writes
    // wrapper.style.height whenever previewHeightPx/editorHeightPx
    // changes -- e.g. the auto-sizing content-height report from the
    // iframe (see noteIframeProtocol.ts). That's a programmatic
    // resize, not a user drag, and must not be treated as one: doing
    // so would permanently disable auto-sizing (autoHeight: false)
    // the moment a note first reports its natural content height.
    // Distinguish it from a real drag on the native resize handle
    // (which always changes width too, since resize:both) by checking
    // whether the wrapper's current height still matches the last
    // height that effect itself applied (getExpectedHeightPx), and
    // whether its width hasn't moved.
    const widthChanged = wrapper.offsetWidth !== lastWidthPx;
    lastWidthPx = wrapper.offsetWidth;
    const heightMatchesStore =
      Math.abs(wrapper.offsetHeight - getExpectedHeightPx()) < 1;
    if (!widthChanged && heightMatchesStore) return;

    // Re-derive the content height from the wrapper's actual size, so
    // a manual drag-resize (which sets the wrapper's height directly,
    // bypassing the note store's effect in mountNote.ts) updates what
    // gets persisted. Whichever height is currently on screen
    // (preview or editor -- see mountNote.ts's own effect) is the one
    // being dragged, so that's the one updated here.
    //
    // A manual resize permanently opts this note out of auto-sizing
    // its preview height (see docs/note-sizing.md) -- editorHeightPx
    // is never gated by autoHeight, so setting it here doesn't change
    // that field's own behavior, only its stored value.
    const contentPx = Math.max(0, wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX);
    if (note.editing) {
      setNote({ editorHeightPx: contentPx, autoHeight: false });
    } else {
      setNote({ previewHeightPx: contentPx, autoHeight: false });
    }

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
