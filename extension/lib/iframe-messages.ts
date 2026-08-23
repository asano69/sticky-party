// Message types passed between the content script (parent, running on
// the host page) and a note's annotation-iframe page (child, running on
// the extension's own origin) via window.postMessage. They're separate
// documents, so this is the only way for them to talk to each other --
// see entrypoints/content.ts for why the note's iframe exists at all.

import type { AnnotationData } from "./messages";

// iframe -> content script, sent once the iframe's own script has
// started and registered its message listener. The content script
// waits for this instead of the iframe's 'load' event, since 'load' can
// fire before the listener exists and silently drop the reply.
export const NOTE_READY_MESSAGE = "sticky-party:note-ready";
export interface NoteReadyMessage {
  type: typeof NOTE_READY_MESSAGE;
}

// content script -> iframe, sent in reply to NOTE_READY_MESSAGE.
export const INIT_NOTE_MESSAGE = "sticky-party:init-note";
export interface InitNoteMessage {
  type: typeof INIT_NOTE_MESSAGE;
  annotation: AnnotationData;
}

// content script -> iframe, sent after every pin toggle, so the title
// row (NoteHeader.tsx) knows whether to reserve left-padding for the
// pin button drawn on top of it by content.ts. content.ts is what
// actually flips the note between fixed/absolute positioning (see
// togglePin there), so its local copy of the pin state has to be
// pushed back into the iframe afterward for the title's own layout to
// stay in sync.
export const NOTE_PIN_MESSAGE = "sticky-party:note-pin";
export interface NotePinMessage {
  type: typeof NOTE_PIN_MESSAGE;
  pin: boolean;
}

// iframe -> content script, sent whenever the note is interacted with,
// so the content script can bring its wrapper to the front -- clicks
// inside the iframe don't bubble out to the wrapper's own listeners,
// since it's a separate document.
export const NOTE_FOCUS_MESSAGE = "sticky-party:note-focus";
export interface NoteFocusMessage {
  type: typeof NOTE_FOCUS_MESSAGE;
}

// iframe -> content script, sent after the annotation has been deleted
// from PocketBase, so the content script can remove this note's wrapper
// from the page.
export const NOTE_DELETED_MESSAGE = "sticky-party:note-deleted";
export interface NoteDeletedMessage {
  type: typeof NOTE_DELETED_MESSAGE;
}

// iframe -> content script, sent while editing whenever the note's
// content height changes (e.g. the body textarea grows to fit its
// text), so the content script can grow the wrapper to match. This
// restores the old Shadow DOM version's auto-growing textarea, which
// an iframe can't reproduce on its own since the wrapper element lives
// in a different document.
export const NOTE_CONTENT_RESIZE_MESSAGE = "sticky-party:note-content-resize";
export interface NoteContentResizeMessage {
  type: typeof NOTE_CONTENT_RESIZE_MESSAGE;
  height: number;
  // Which mode the iframe was actually in when it took this
  // measurement. content.ts keeps its own mirrored copy of the editing
  // flag (see NOTE_EDITING_MESSAGE above), but that copy can lag one
  // message behind this one -- e.g. a measurement taken just before
  // editing ends can arrive after NOTE_EDITING_MESSAGE(false) already
  // flipped the mirror. Carrying the flag here lets
  // noteIframeProtocol.ts route the measurement correctly regardless
  // of that ordering, instead of trusting its own possibly-stale copy.
  editing: boolean;
}

// content script -> iframe, sent when the user double-clicks the drag
// header outside the Dismiss button (see entrypoints/content.ts), so
// the iframe can start editing the title. The header lives in the
// content script's document and never touches note content itself, so
// it can't start editing directly -- it only knows a double-click
// landed somewhere in the title row and asks the iframe to act on it.
export const START_EDIT_TITLE_MESSAGE = "sticky-party:start-edit-title";
export interface StartEditTitleMessage {
  type: typeof START_EDIT_TITLE_MESSAGE;
}

// iframe -> content script, sent whenever edit mode toggles. Drives two
// things on the content script side, both non-authoritative for sizing:
// (1) the drag header stops intercepting pointer events while editing,
// letting clicks reach the title input inside the iframe, and resumes
// once editing ends; (2) a manual resize (noteResizing.ts) uses this
// flag to decide which height field (editorHeightPx/previewHeightPx) to
// write into. It is NOT used to detect whether a resize happened at all
// -- that comparison is against the wrapper's own last-applied height
// snapshot instead (see mountNote.ts/noteResizing.ts's
// getExpectedHeightPx), so this message arriving asynchronously
// relative to NOTE_CONTENT_RESIZE_MESSAGE can never cause a false
// resize detection.
export const NOTE_EDITING_MESSAGE = "sticky-party:note-editing";
export interface NoteEditingMessage {
  type: typeof NOTE_EDITING_MESSAGE;
  editing: boolean;
}

// Height (in px) of the note's title row -- matches Tailwind's h-8
// (2rem) in NoteContent.tsx, and roughly matches the footer's height
// (icon button + padding) so the header doesn't look squashed next to
// the body/footer. The row itself is rendered inside the iframe (see
// NoteContent.tsx), since it displays the title text, but the content
// script's transparent drag-header overlay (see content.ts) must be
// exactly this tall too, so the two documents' header regions line up
// pixel-for-pixel.
export const TITLE_ROW_HEIGHT_PX = 32;

// Width (px) reserved at the header row's right edge for the Dismiss
// button, which renders inside the iframe (NoteHeader.tsx) rather than
// as a plain DOM element drawn by content.ts. Content.ts's drag-header
// overlay (noteChrome.ts) must stop this far short of the row's right
// edge, or it would sit on top of the iframe and swallow every click
// meant for the button underneath.
export const DISMISS_BUTTON_AREA_PX = 40;

// iframe -> content script, sent when the footer's pin toggle button is
// clicked. Only content.ts can perform the actual toggle: it needs the
// page's current scroll offset to convert between fixed/absolute
// positioning, which only it has access to (see content.ts's
// togglePin). The iframe just requests the toggle and waits for
// NOTE_PIN_MESSAGE to report the resulting state back.
export const TOGGLE_PIN_MESSAGE = "sticky-party:toggle-pin";
export interface TogglePinMessage {
  type: typeof TOGGLE_PIN_MESSAGE;
}

// iframe -> content script, sent when the header's Dismiss button is
// clicked. The button now renders inside the iframe (NoteHeader.tsx)
// instead of as a plain DOM element on the host page, so it isn't
// exposed to that page's own CSS -- see noteChrome.ts. Only content.ts
// can perform the actual removal though, since it owns the wrapper
// element, so this just requests it.
export const REQUEST_DISMISS_MESSAGE = "sticky-party:request-dismiss";
export interface RequestDismissMessage {
  type: typeof REQUEST_DISMISS_MESSAGE;
}

export type ParentToNoteMessage =
  InitNoteMessage | StartEditTitleMessage | NotePinMessage;
export type NoteToParentMessage =
  | NoteReadyMessage
  | NoteFocusMessage
  | NoteDeletedMessage
  | NoteContentResizeMessage
  | NoteEditingMessage
  | TogglePinMessage
  | RequestDismissMessage;
