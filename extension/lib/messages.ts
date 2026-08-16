// Message types sent from the background script to a tab's content
// script (see entrypoints/background.ts and entrypoints/content.ts).
// Kept in one place so both sides stay in sync.

export const SHOW_ANNOTATION_MESSAGE = 'web-anno:show-annotation';
export const HIDE_ANNOTATION_MESSAGE = 'web-anno:hide-annotation';

export interface ShowAnnotationMessage {
  type: typeof SHOW_ANNOTATION_MESSAGE;
  // One or more annotation bodies matching the current page. Kept as a
  // list (not merged into one string) so the content script can show
  // them one at a time instead of concatenating unrelated notes.
  bodies: string[];
}

export interface HideAnnotationMessage {
  type: typeof HIDE_ANNOTATION_MESSAGE;
}

export type AnnotationMessage = ShowAnnotationMessage | HideAnnotationMessage;
