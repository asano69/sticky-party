// Message types passed between the background script and a tab's
// content script (see entrypoints/background.ts and
// entrypoints/content.ts). Kept in one place so both sides stay in sync.

import type { PositionData, ViewportInfo } from "./positions";

// background -> content
export const SHOW_ANNOTATION_MESSAGE = "sticky-party:show-annotation";
export const HIDE_ANNOTATION_MESSAGE = "sticky-party:hide-annotation";
// content -> background
export const CHECK_ANNOTATION_MESSAGE = "sticky-party:check-annotation";

// content -> background: fetch/save a note's position and size.
// Routed through the background script rather than calling PocketBase
// directly from content.ts, because a content script's own network
// requests are treated differently from the extension's (Firefox
// attributes them to the host page's origin, which broke loading saved
// positions once the extension was installed as a real add-on instead
// of run via `wxt dev`).
export const GET_POSITION_MESSAGE = "sticky-party:get-position";
export const SAVE_POSITION_MESSAGE = "sticky-party:save-position";

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

// content -> background: pin (or unpin) an annotation to a fixed spot
// on the page. Unlike GET_POSITION_MESSAGE/SAVE_POSITION_MESSAGE, this
// writes straight to the annotation record (see lib/annotations.ts's
// setAnnotationPin), not the positions collection -- pin is shared by
// every viewer, not a per-user preference. `coords` is only sent when
// pinning (content.ts's togglePin/persistPosition); unpinning just
// clears the flag.
export const SET_ANNOTATION_PIN_MESSAGE = "sticky-party:set-annotation-pin";
export interface SetAnnotationPinMessage {
  type: typeof SET_ANNOTATION_PIN_MESSAGE;
  annotationId: string;
  pin: boolean;
  coords?: { xRatio: number; yRatio: number; width: number; height: number };
}

export type PositionMessage =
  GetPositionMessage | SavePositionMessage | SetAnnotationPinMessage;

// A single annotation's id (needed to save edits back to PocketBase),
// body text, and last-updated timestamp. `updated` drives the stacking
// order in AnnotationBoard: notes are sorted oldest-first so the most
// recently edited one ends up last in the DOM and renders on top (see
// fetchAnnotations in lib/annotations.ts).
export interface AnnotationData {
  id: string;
  // The normalized target URL this annotation belongs to. Needed to
  // subscribe to the right target-scoped BroadcastChannel for realtime
  // updates (see lib/realtime-channel.ts and useRealtimeUpdates.ts).
  target: string;
  title: string;
  body: string;
  // Whether this note's body is blurred (shoulder-surfing protection),
  // toggled via the eye/eye-off button in NoteContent.tsx's footer.
  hide: boolean;
  // Background color name (see lib/colors.ts), toggled via the palette
  // button in NoteContent.tsx's footer. Empty/unrecognized values fall
  // back to DEFAULT_NOTE_COLOR.
  color: string;
  // Whether this note is pinned to a fixed spot on the page (position:
  // absolute, so it scrolls with the page) instead of following the
  // viewport (position: fixed, the default). Shared by every viewer --
  // unlike ordinary position, which is per-user (see lib/positions.ts)
  // -- so it lives on the annotation record itself, toggled via the
  // footer's pin button (see NoteFooter.tsx/lib/annotations.ts's
  // setAnnotationPin).
  pin: boolean;
  // Pinned coordinates, as ratios of the whole document (not the
  // window) plus a fixed pixel size. Only meaningful when pin is true;
  // ignored otherwise.
  pinXRatio: number;
  pinYRatio: number;
  pinWidth: number;
  pinHeight: number;
  updated: string;
}

export interface ShowAnnotationMessage {
  type: typeof SHOW_ANNOTATION_MESSAGE;
  // One or more annotations matching the current page. Kept as a list
  // (not merged into one string) so the content script can show them as
  // separate sticky notes instead of concatenating unrelated notes.
  annotations: AnnotationData[];
  // The normalized target these annotations were fetched for (see
  // lib/targets.ts's normalizeTarget). Passed through explicitly so the
  // realtime-orchestrator iframe can subscribe to the right filter
  // without re-deriving it -- see lib/realtime-messages.ts.
  target: string;
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
