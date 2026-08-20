// Applies realtime "update" events onto this note's store, so edits
// made by another tab/user appear immediately without a reload or a
// manual refetch (see docs/realtime-sync.md). Listens on the
// target-scoped BroadcastChannel the realtime-orchestrator iframe
// broadcasts to (see lib/realtime-channel.ts) -- both this iframe and
// the orchestrator are same-origin extension pages, so no relay
// through content.ts is needed here, unlike create/delete (see
// docs/realtime-sync.md's routing table).
//
// Applied unconditionally, even while editing: overwriting an
// in-progress local edit with another user's update is safer than the
// alternative (this note silently going stale without the viewer
// noticing) -- see docs/realtime-sync.md.
//
// A target's channel can carry updates for annotations other than this
// one (multiple notes can share a target), so every message is matched
// against this note's own id before being applied.

import { createEffect, onCleanup } from "solid-js";
import type { SetStoreFunction } from "solid-js/store";

import { realtimeChannelName } from "../../lib/realtime-channel";
import type { RealtimeUpdatePayload } from "../../lib/realtime-messages";
import type { AnnotationData } from "../../lib/messages";

export function useRealtimeUpdates(params: {
  annotation: () => AnnotationData | undefined;
  setAnnotation: SetStoreFunction<{ annotation?: AnnotationData }>;
}) {
  let channel: BroadcastChannel | undefined;

  // Subscribes once, as soon as the annotation (and therefore its
  // target/id) first becomes available -- annotation() only flips from
  // undefined to set once per note (see useParentMessaging.ts's
  // onInit), so this effect never needs to re-subscribe afterward.
  createEffect(() => {
    const note = params.annotation();
    if (!note || channel) return;
    channel = new BroadcastChannel(realtimeChannelName(note.target));
    channel.onmessage = (e: MessageEvent<RealtimeUpdatePayload>) => {
      if (e.data.record.id !== note.id) return;
      params.setAnnotation("annotation", e.data.record);
    };
  });

  onCleanup(() => channel?.close());
}
