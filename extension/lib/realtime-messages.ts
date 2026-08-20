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

export type OrchestratorToParentMessage =
  | OrchestratorReadyMessage
  | AnnotationCreatedMessage
  | AnnotationDeletedMessage;
export type ParentToOrchestratorMessage = InitOrchestratorMessage;

// The payload broadcast on a target-scoped BroadcastChannel for
// "update" events -- see lib/realtime-channel.ts for the channel name
// itself. Each NoteContent iframe listens and applies this if it
// matches its own annotation id.
export interface RealtimeUpdatePayload {
  record: AnnotationData;
}
