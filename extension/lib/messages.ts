// Message types sent from the background script to a tab's content
// script (see entrypoints/background.ts and entrypoints/content.ts).
// Kept in one place so both sides stay in sync.

export const SHOW_ANNOTATION_MESSAGE = 'web-anno:show-annotation';
export const HIDE_ANNOTATION_MESSAGE = 'web-anno:hide-annotation';

export interface ShowAnnotationMessage {
  type: typeof SHOW_ANNOTATION_MESSAGE;
  body: string;
}

export interface HideAnnotationMessage {
  type: typeof HIDE_ANNOTATION_MESSAGE;
}

export type AnnotationMessage = ShowAnnotationMessage | HideAnnotationMessage;
