// Applies realtime "histories" row events onto this note's edit-history
// list, so the panel opened from NoteFooter.tsx stays current without a
// refetch on every open (see docs/target-list-sync.md's "編集履歴パネル
// のリアルタイム更新"). Subscribes on the target-scoped BroadcastChannel
// the realtime-orchestrator iframe broadcasts history rows to (see
// lib/realtime-channel.ts) -- deliberately a separate channel from
// useRealtimeUpdates.ts's, so annotation updates and history rows never
// need a discriminated union to tell apart.
//
// A target's history channel can carry rows for annotations other than
// this one (multiple notes can share a target), so every message is
// matched against this note's own id before being applied.

import { createEffect, onCleanup } from "solid-js";

import { realtimeHistoryChannelName } from "../../lib/realtime-channel";
import type { RealtimeHistoryPayload } from "../../lib/realtime-messages";
import type { HistoryEntry } from "../../lib/history";
import type { AnnotationData } from "../../lib/messages";

export function useHistoryUpdates(params: {
  annotation: () => AnnotationData | undefined;
  onEntry: (entry: HistoryEntry) => void;
}) {
  let channel: BroadcastChannel | undefined;

  // Subscribes once, as soon as the annotation (and therefore its
  // target/id) first becomes available -- mirrors
  // useRealtimeUpdates.ts's own subscribe-once effect.
  createEffect(() => {
    const note = params.annotation();
    if (!note || channel) return;
    channel = new BroadcastChannel(realtimeHistoryChannelName(note.target));
    channel.onmessage = (e: MessageEvent<RealtimeHistoryPayload>) => {
      if (e.data.record.annotationId !== note.id) return;
      params.onEntry(e.data.record);
    };
  });

  onCleanup(() => channel?.close());
}
