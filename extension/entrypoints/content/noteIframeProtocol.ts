// Wires the window.postMessage protocol between this note's wrapper
// (this document) and its annotation-iframe (a separate, same-
// extension-origin document) -- see lib/iframe-messages.ts for the
// protocol definitions and entrypoints/content/index.ts's header
// comment for why this split exists at all.

import {
  INIT_NOTE_MESSAGE,
  NOTE_CONTENT_RESIZE_MESSAGE,
  NOTE_DELETED_MESSAGE,
  NOTE_EDITING_MESSAGE,
  NOTE_FOCUS_MESSAGE,
  NOTE_PIN_MESSAGE,
  NOTE_READY_MESSAGE,
  TOGGLE_PIN_MESSAGE,
  type NotePinMessage,
} from "../../lib/iframe-messages";
import type { AnnotationData } from "../../lib/messages";

export interface NoteIframeProtocolState {
  cleanup: () => void;
}

export function wireIframeProtocol(params: {
  iframe: HTMLIFrameElement;
  iframeOrigin: string;
  annotation: AnnotationData;
  header: HTMLElement;
  note: { pinned: boolean; contentHeightPx: number };
  setNote: (patch: { contentHeightPx?: number; editing?: boolean }) => void;
  // Floor for the iframe's one-and-only non-editing content-height
  // report -- see mountNote.ts's header comment and
  // docs/note-sizing.md.
  restoredFloorPx?: number;
  removeLoadingOverlay: () => void;
  bringToFront: () => void;
  togglePin: () => void;
  onDeleted: () => void;
}): NoteIframeProtocolState {
  const {
    iframe,
    iframeOrigin,
    annotation,
    header,
    note,
    setNote,
    restoredFloorPx,
    removeLoadingOverlay,
    bringToFront,
    togglePin,
    onDeleted,
  } = params;

  // Captured the moment editing starts: the note's resting content
  // height right before editing began. Used as a floor for
  // NOTE_CONTENT_RESIZE_MESSAGE while editing, so switching into edit
  // mode never shrinks the note down to whatever the textarea's own
  // (possibly much smaller) content happens to measure -- e.g. a note
  // whose body is just an attachment embed (![[id]]) is one line of
  // raw markdown in the textarea, but rendered much taller in view
  // mode. Reset to undefined once editing ends, so the next edit
  // session starts from a fresh floor instead of an earlier one.
  let editingFloorPx: number | undefined;

  const onMessage = (e: MessageEvent) => {
    if (e.source !== iframe.contentWindow) return;
    if (e.data?.type === NOTE_READY_MESSAGE) {
      // Hand the annotation to the iframe once it reports itself
      // ready, rather than on the iframe's 'load' event -- 'load' can
      // fire before the iframe's own script has registered its
      // message listener, silently dropping the very first message.
      iframe.contentWindow?.postMessage(
        { type: INIT_NOTE_MESSAGE, annotation },
        iframeOrigin,
      );
      // pin isn't part of AnnotationData (it lives in the `positions`
      // collection now, not `annotations` -- see lib/positions.ts),
      // so it's reported to the iframe separately, right after init.
      iframe.contentWindow?.postMessage(
        {
          type: NOTE_PIN_MESSAGE,
          pin: note.pinned,
        } satisfies NotePinMessage,
        iframeOrigin,
      );
    } else if (e.data?.type === NOTE_DELETED_MESSAGE) {
      onDeleted();
    } else if (e.data?.type === NOTE_FOCUS_MESSAGE) {
      bringToFront();
    } else if (e.data?.type === NOTE_CONTENT_RESIZE_MESSAGE) {
      // Grow (or shrink back) the wrapper to fit the iframe's main
      // content, restoring the old Shadow DOM version's auto-growing
      // textarea. Never go below whichever floor currently applies:
      // editingFloorPx while editing (so an existing note doesn't
      // shrink the instant editing starts), or restoredFloorPx
      // otherwise (so a note manually resized taller than its text
      // doesn't snap back down right after a reload).
      setNote({
        contentHeightPx: Math.max(
          e.data.height,
          editingFloorPx ?? restoredFloorPx ?? 0,
        ),
      });
      // The iframe has now measured and reported real content, so the
      // note is actually showing something -- remove the loading
      // spinner.
      removeLoadingOverlay();
    } else if (e.data?.type === NOTE_EDITING_MESSAGE) {
      // Capture (or release) the editing floor right as edit mode
      // toggles -- before this note's own contentHeightPx has any
      // chance to change, so the captured value is always the
      // resting (view-mode) height, never an already-shrunk one.
      editingFloorPx = e.data.editing ? note.contentHeightPx : undefined;
      setNote({ editing: e.data.editing });
      // Stop the header from intercepting pointer events while
      // editing, so clicks reach the title input inside the iframe.
      header.style.pointerEvents = e.data.editing ? "none" : "auto";
    } else if (e.data?.type === TOGGLE_PIN_MESSAGE) {
      // Requested by the footer's pin button (see NoteFooter.tsx /
      // useParentMessaging.ts's sendTogglePin). Only content.ts can
      // perform the actual toggle, since it needs the page's current
      // scroll offset to convert between fixed/absolute positioning.
      togglePin();
    }
  };
  window.addEventListener("message", onMessage);

  return {
    cleanup: () => window.removeEventListener("message", onMessage),
  };
}
