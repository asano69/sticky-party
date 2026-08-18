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

// iframe -> content script, sent whenever edit mode toggles, so the
// content script's drag header can stop intercepting pointer events
// while editing -- letting clicks reach the title input inside the
// iframe -- and resume intercepting once editing ends.
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

export type ParentToNoteMessage =
  | InitNoteMessage
  | StartEditTitleMessage
  | NotePinMessage;
export type NoteToParentMessage =
  | NoteReadyMessage
  | NoteFocusMessage
  | NoteDeletedMessage
  | NoteContentResizeMessage
  | NoteEditingMessage;
