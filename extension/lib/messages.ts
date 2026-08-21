// Message types passed between the background script and a tab's
// content script (see entrypoints/background.ts and
// entrypoints/content.ts). Kept in one place so both sides stay in sync.

import type { PositionData } from "./positions";

// background -> content
export const SHOW_ANNOTATION_MESSAGE = "sticky-party:show-annotation";
export const HIDE_ANNOTATION_MESSAGE = "sticky-party:hide-annotation";
// content -> background
export const CHECK_ANNOTATION_MESSAGE = "sticky-party:check-annotation";

// content -> background: fetch/save a note's shared position, size,
// pin state, and z-index. Routed through the background script rather
// than calling PocketBase directly from content.ts, because a content
// script's own network requests are treated differently from the
// extension's (Firefox attributes them to the host page's origin,
// which broke loading saved positions once the extension was installed
// as a real add-on instead of run via `wxt dev`).
export const GET_POSITION_MESSAGE = "sticky-party:get-position";
export const SAVE_POSITION_MESSAGE = "sticky-party:save-position";

export interface GetPositionMessage {
  type: typeof GET_POSITION_MESSAGE;
  annotationId: string;
}

export interface SavePositionMessage {
  type: typeof SAVE_POSITION_MESSAGE;
  annotationId: string;
  position: PositionData;
  existingId?: string;
}

export type PositionMessage = GetPositionMessage | SavePositionMessage;

// A single annotation's id (needed to save edits back to PocketBase),
// content, and last-updated timestamp. Position/size/pin/z now live
// entirely in the `positions` collection (see lib/positions.ts) --
// annotations only ever holds the note's content. `updated` drives the
// stacking order in AnnotationBoard: notes are sorted oldest-first so
// the most recently edited one ends up last in the DOM and renders on
// top (see fetchAnnotations in lib/annotations.ts).
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

// popup -> background: re-check every open tab against the local
// target cache. Sent after the popup refreshes that cache itself (see
// entrypoints/popup/App.tsx's checkConfigured/handleSync), since a
// target that only just appeared in the cache might already match a
// tab that's sitting open on it -- without this, that tab would only
// ever pick up the change on its next navigation.
export const RECHECK_ALL_TABS_MESSAGE = "sticky-party:recheck-all-tabs";
export interface RecheckAllTabsMessage {
  type: typeof RECHECK_ALL_TABS_MESSAGE;
}

// content -> background: relayed from the realtime-orchestrator (see
// lib/realtime-messages.ts's TARGET_HISTORY_CREATED_MESSAGE) when a new
// annotation's target appears anywhere, not just the current page. Only
// background.ts can act on it, since it owns lib/targets.ts's cache.
export const ADD_CACHED_TARGET_MESSAGE = "sticky-party:add-cached-target";
export interface AddCachedTargetMessage {
  type: typeof ADD_CACHED_TARGET_MESSAGE;
  target: string;
  updated: string;
}

// popup -> background: log out of the current profile. lib/session.ts's
// logout() clears every profile-scoped storage key directly, but a
// tab's mounted notes/orchestrator and the toolbar's per-tab badge/
// title are live state in already-running contexts, not storage --
// only background.ts (which can enumerate every tab) can reach them.
export const SESSION_RESET_MESSAGE = "sticky-party:session-reset";
export interface SessionResetMessage {
  type: typeof SESSION_RESET_MESSAGE;
}
