// Message types passed between the background script and a tab's
// content script (see entrypoints/background.ts and
// entrypoints/content.ts). Kept in one place so both sides stay in sync.

// background -> content
export const SHOW_ANNOTATION_MESSAGE = 'web-anno:show-annotation';
export const HIDE_ANNOTATION_MESSAGE = 'web-anno:hide-annotation';
// content -> background
export const CHECK_ANNOTATION_MESSAGE = 'web-anno:check-annotation';

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

// Sent by the content script as soon as it starts, so the background
// script can check the page even if the script finished injecting after
// tabs.onUpdated already fired and missed it (see entrypoints/content.ts).
export interface CheckAnnotationMessage {
  type: typeof CHECK_ANNOTATION_MESSAGE;
  url: string;
}
