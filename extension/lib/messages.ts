// Message types passed between the background script and a tab's
// content script (see entrypoints/background.ts and
// entrypoints/content.ts). Kept in one place so both sides stay in sync.

// background -> content
export const SHOW_ANNOTATION_MESSAGE = 'sticky-party:show-annotation';
export const HIDE_ANNOTATION_MESSAGE = 'sticky-party:hide-annotation';
// content -> background
export const CHECK_ANNOTATION_MESSAGE = 'sticky-party:check-annotation';

// A single annotation's id (needed to save edits back to PocketBase),
// body text, and last-updated timestamp. `updated` drives the stacking
// order in AnnotationBoard: notes are sorted oldest-first so the most
// recently edited one ends up last in the DOM and renders on top (see
// fetchAnnotations in lib/annotations.ts).
export interface AnnotationData {
  id: string;
  title: string;
  body: string;
  // Whether this note's body is blurred (shoulder-surfing protection),
  // toggled via the eye/eye-off button in NoteContent.tsx's footer.
  hide: boolean;
  updated: string;
}

export interface ShowAnnotationMessage {
  type: typeof SHOW_ANNOTATION_MESSAGE;
  // One or more annotations matching the current page. Kept as a list
  // (not merged into one string) so the content script can show them as
  // separate sticky notes instead of concatenating unrelated notes.
  annotations: AnnotationData[];
}

export interface HideAnnotationMessage {
  type: typeof HIDE_ANNOTATION_MESSAGE;
}

export type AnnotationMessage = ShowAnnotationMessage | HideAnnotationMessage;

// Sent by the content script as soon as it starts, so the background
// script can check the page even if the script finished injecting after
// tabs.onUpdated already fired and missed it (see entrypoints/content.ts).
export interface CheckAnnotationMessage {
  type: typeof CHECK_ANNOTATION_MESSAGE;
  url: string;
  // Set explicitly when sent from the popup, which has no sender.tab
  // context of its own. Content scripts omit this and rely on
  // sender.tab.id instead (see background.ts's listener).
  tabId?: number;
}
