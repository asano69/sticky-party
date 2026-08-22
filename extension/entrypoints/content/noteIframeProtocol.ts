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
  TITLE_ROW_HEIGHT_PX,
  TOGGLE_PIN_MESSAGE,
  type NotePinMessage,
} from "../../lib/iframe-messages";
import type { AnnotationData } from "../../lib/messages";

// Upper bound for an auto-sized preview height (see docs/note-sizing.md):
// a note with a lot of content (long text, several images) shouldn't
// grow to fill the whole page on its own. Only applied while
// note.autoHeight is true -- a manually resized note can be made
// taller than this without limit (see noteResizing.ts).
const MAX_AUTO_PREVIEW_HEIGHT_PX = 500;

export interface NoteIframeProtocolState {
  cleanup: () => void;
}

export function wireIframeProtocol(params: {
  iframe: HTMLIFrameElement;
  iframeOrigin: string;
  annotation: AnnotationData;
  header: HTMLElement;
  note: { pinned: boolean; editing: boolean; autoHeight: boolean };
  setNote: (patch: {
    previewHeightPx?: number;
    editorHeightPx?: number;
    editing?: boolean;
  }) => void;
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
    removeLoadingOverlay,
    bringToFront,
    togglePin,
    onDeleted,
  } = params;

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
      // The iframe reports the main area's own content height for
      // whichever mode it's currently in (see useContentHeight.ts) --
      // it has no notion of the footer, since that's only rendered
      // while editing and lives entirely in this document (see
      // NoteContent.tsx / entrypoints/content/index.ts's header
      // comment). Editing and view mode write to entirely separate
      // fields, so neither can ever clobber the other's saved size.
      if (note.editing) {
        setNote({ editorHeightPx: e.data.height + TITLE_ROW_HEIGHT_PX });
      } else if (note.autoHeight) {
        // Auto-sizing is only ever capped, never floored -- a note
        // that's genuinely short is allowed to stay short.
        setNote({
          previewHeightPx: Math.min(e.data.height, MAX_AUTO_PREVIEW_HEIGHT_PX),
        });
      }
      // The iframe has now measured and reported real content, so the
      // note is actually showing something -- remove the loading
      // spinner.
      removeLoadingOverlay();
    } else if (e.data?.type === NOTE_EDITING_MESSAGE) {
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
