// Message types passed between the background script and a tab's
// content script (see entrypoints/background.ts and
// entrypoints/content.ts). Kept in one place so both sides stay in sync.

import type { PositionData, ViewportInfo } from './positions';

// background -> content
export const SHOW_ANNOTATION_MESSAGE = 'sticky-party:show-annotation';
export const HIDE_ANNOTATION_MESSAGE = 'sticky-party:hide-annotation';
// content -> background
export const CHECK_ANNOTATION_MESSAGE = 'sticky-party:check-annotation';

// content -> background: fetch/save a note's position and size.
// Routed through the background script rather than calling PocketBase
// directly from content.ts, because a content script's own network
// requests are treated differently from the extension's (Firefox
// attributes them to the host page's origin, which broke loading saved
// positions once the extension was installed as a real add-on instead
// of run via `wxt dev`).
export const GET_POSITION_MESSAGE = 'sticky-party:get-position';
export const SAVE_POSITION_MESSAGE = 'sticky-party:save-position';

export interface GetPositionMessage {
  type: typeof GET_POSITION_MESSAGE;
  annotationId: string;
  // The content page's own viewport/screen -- lib/positions.ts runs in
  // the background script, which has no access to the content page's
  // `window`/`screen` (see lib/positions.ts for why that matters).
  viewport: ViewportInfo;
}

export interface SavePositionMessage {
  type: typeof SAVE_POSITION_MESSAGE;
  annotationId: string;
  position: PositionData;
  viewport: ViewportInfo;
  existingId?: string;
}

export type PositionMessage = GetPositionMessage | SavePositionMessage;

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
  // Background color name (see lib/colors.ts), toggled via the palette
  // button in NoteContent.tsx's footer. Empty/unrecognized values fall
  // back to DEFAULT_NOTE_COLOR.
  color: string;
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
