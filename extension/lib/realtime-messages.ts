// Message types for the realtime-orchestrator iframe <-> content.ts.
// The orchestrator subscribes to PocketBase realtime for the current
// page's target and relays create/delete events to content.ts (which
// owns the wrapper elements needed to mount/unmount a note -- see
// entrypoints/content.ts). Update events skip content.ts entirely and
// go straight to the affected note's own iframe via a target-scoped
// BroadcastChannel (see lib/realtime-channel.ts), since both are
// same-origin extension pages and content.ts has no role to play in
// an in-place content update.

import type { AnnotationData } from "./messages";
import type { HistoryEntry } from "./history";
import type { Anchor } from "./positions";

// content.ts -> orchestrator, sent once on mount and again whenever
// the page's matched target changes (e.g. a client-side route change),
// so a single orchestrator iframe can be reused instead of being torn
// down and recreated -- see entrypoints/content.ts.
export const INIT_ORCHESTRATOR_MESSAGE = "sticky-party:init-orchestrator";
export interface InitOrchestratorMessage {
  type: typeof INIT_ORCHESTRATOR_MESSAGE;
  target: string;
}

// orchestrator -> content.ts, sent once the orchestrator's own script
// has started and registered its message listener -- same reasoning as
// NOTE_READY_MESSAGE in lib/iframe-messages.ts.
export const ORCHESTRATOR_READY_MESSAGE = "sticky-party:orchestrator-ready";
export interface OrchestratorReadyMessage {
  type: typeof ORCHESTRATOR_READY_MESSAGE;
}

// orchestrator -> content.ts: another user created/deleted an
// annotation for the target this orchestrator is subscribed to. Only
// content.ts can act on these, since it owns the wrapper elements.
export const ANNOTATION_CREATED_MESSAGE = "sticky-party:annotation-created";
export interface AnnotationCreatedMessage {
  type: typeof ANNOTATION_CREATED_MESSAGE;
  annotation: AnnotationData;
}

export const ANNOTATION_DELETED_MESSAGE = "sticky-party:annotation-deleted";
export interface AnnotationDeletedMessage {
  type: typeof ANNOTATION_DELETED_MESSAGE;
  annotationId: string;
}

// orchestrator -> content.ts: a new annotation was created for some
// target, detected via a target-agnostic subscribe on the "histories"
// collection filtered to action="create" rows only (see
// docs/target-list-sync.md). Unlike ANNOTATION_CREATED_MESSAGE above,
// this isn't scoped to the current page's target -- it exists purely to
// let the local target cache (lib/targets.ts) learn about a target
// created anywhere, not just here. content.ts has no direct access to
// that cache (it lives in background.ts), so it only relays this
// message onward -- see entrypoints/background.ts's handling of
// ADD_CACHED_TARGET_MESSAGE.
export const TARGET_HISTORY_CREATED_MESSAGE =
  "sticky-party:target-history-created";
export interface TargetHistoryCreatedMessage {
  type: typeof TARGET_HISTORY_CREATED_MESSAGE;
  target: string;
  updated: string;
}

export type OrchestratorToParentMessage =
  | OrchestratorReadyMessage
  | AnnotationCreatedMessage
  | AnnotationDeletedMessage
  | AnnotationPositionUpdatedMessage
  | TargetHistoryCreatedMessage;
export type ParentToOrchestratorMessage = InitOrchestratorMessage;

// The payload broadcast on a target-scoped BroadcastChannel for
// "update" events -- see lib/realtime-channel.ts for the channel name
// itself. Each NoteContent iframe listens and applies this if it
// matches its own annotation id.
export interface RealtimeUpdatePayload {
  record: AnnotationData;
}

// The payload broadcast on the target-scoped history BroadcastChannel
// (see lib/realtime-channel.ts's realtimeHistoryChannelName) for every
// "histories" row -- create, a fresh update row, or a merged update
// overwriting a previous one (see internal/history's merge rule).
// Reuses HistoryEntry as-is since the shape needed here (id,
// annotationId, action, updated, userName) is identical to what
// lib/history.ts's fetchHistory already returns -- each NoteContent
// iframe matches record.annotationId against its own annotation id.
export interface RealtimeHistoryPayload {
  record: HistoryEntry;
}

// orchestrator -> content.ts: a note's shared position, size, pin
// state, or stacking order changed (see lib/positions.ts -- position
// is no longer per-user, so this now applies to every note, not just
// pinned ones). x/y are document-size ratios; width/height are in rem
// -- see lib/positions.ts for why. Only content.ts can act on this: it
// owns the wrapper element and is the sole place a note's on-page
// position is applied (see entrypoints/content/mountNote.ts's
// applyRemotePosition).
export const ANNOTATION_POSITION_UPDATED_MESSAGE =
  "sticky-party:annotation-position-updated";
export interface AnnotationPositionUpdatedMessage {
  type: typeof ANNOTATION_POSITION_UPDATED_MESSAGE;
  annotationId: string;
  pin: boolean;
  anchorX: Anchor;
  anchorY: Anchor;
  x: number;
  y: number;
  width: number;
  height: number;
  // Whether the preview height should keep auto-following the
  // content's natural size (see docs/note-sizing.md). Relayed so a
  // remote viewer's manual resize (which permanently disables
  // auto-sizing) is reflected here too, not just the height itself.
  autoHeight: boolean;
  z: number;
}
