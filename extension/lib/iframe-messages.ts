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

export type ParentToNoteMessage = InitNoteMessage;
export type NoteToParentMessage = NoteReadyMessage | NoteFocusMessage | NoteDeletedMessage;
