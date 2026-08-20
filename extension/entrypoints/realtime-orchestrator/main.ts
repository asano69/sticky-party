// Subscribes to PocketBase realtime for the page's current target and
// relays events onward: "update" goes straight to the matching note's
// iframe via a target-scoped BroadcastChannel; "create"/"delete" are
// relayed to content.ts (via window.parent), since only content.ts can
// mount/unmount a note's wrapper element -- see docs and
// lib/realtime-messages.ts for the full protocol.
//
// No UI, so this is plain TS rather than a solid.js component -- there
// is nothing to render, only a subscription to manage.

import {
  ANNOTATION_CREATED_MESSAGE,
  ANNOTATION_DELETED_MESSAGE,
  ANNOTATION_POSITION_UPDATED_MESSAGE,
  INIT_ORCHESTRATOR_MESSAGE,
  ORCHESTRATOR_READY_MESSAGE,
  TARGET_HISTORY_CREATED_MESSAGE,
  type AnnotationCreatedMessage,
  type AnnotationDeletedMessage,
  type AnnotationPositionUpdatedMessage,
  type ParentToOrchestratorMessage,
  type RealtimeHistoryPayload,
  type RealtimeUpdatePayload,
  type TargetHistoryCreatedMessage,
} from "../../lib/realtime-messages";
import {
  realtimeChannelName,
  realtimeHistoryChannelName,
} from "../../lib/realtime-channel";
import { getAuthedPb } from "../../lib/pb";
import type { AnnotationData } from "../../lib/messages";
import type { RecordSubscription } from "pocketbase";

// How many times to retry the *initial* subscribe() call if it fails
// (e.g. a token that's momentarily invalid). Once subscribed, the
// PocketBase SDK's own realtime client handles reconnection and
// re-authentication on its own using whatever token is currently in
// browser.storage.local -- see docs/pocketbase-auth.md on why that's
// enough: any other context (popup, background.ts's periodic sync)
// re-authenticating refreshes the shared token, and the next
// auto-reconnect picks it up. So this only needs to cover the
// "never got subscribed in the first place" case, not permanent
// backoff bookkeeping.
const INITIAL_RETRY_DELAYS_MS = [1000, 5000, 15000];

let channel: BroadcastChannel | undefined;
let unsubscribe: (() => void) | undefined;
// Target-scoped "histories" subscribe backing each note's edit-history
// panel (see subscribeTargetHistoryScoped below). Shares
// subscribeTarget's per-target lifecycle -- torn down and re-subscribed
// together on every INIT_ORCHESTRATOR_MESSAGE -- since, like the
// annotations subscribe above, it only matters for the page currently
// being viewed. Kept as separate channel/unsubscribe vars (not folded
// into channel/unsubscribe above) so this subscribe's own teardown
// can't be accidentally skipped if the two ever need different timing.
let historyChannel: BroadcastChannel | undefined;
let unsubscribeHistory: (() => void) | undefined;
// Bumped on every re-target, so a subscribe() call that resolves after
// a newer target has already taken over can detect it's stale and
// unsubscribe itself instead of delivering events for the wrong page.
let generation = 0;

// A "histories" row, as needed by both subscribes below -- the
// target-list subscribe (action="create" only, target-agnostic) reads
// only target/updated; the history-panel subscribe
// (target-scoped) needs the rest to build a HistoryEntry. `action` here
// is the row's own field recording what happened to the annotation
// (create/update/delete), not the realtime event's action.
interface HistoryRecord {
  id: string;
  annotationId: string;
  target: string;
  action: "create" | "update" | "delete";
  updated: string;
  userName: string;
}

function teardown() {
  unsubscribe?.();
  unsubscribe = undefined;
  channel?.close();
  channel = undefined;
  unsubscribeHistory?.();
  unsubscribeHistory = undefined;
  historyChannel?.close();
  historyChannel = undefined;
}

async function subscribeTarget(
  target: string,
  myGeneration: number,
  attempt = 0,
) {
  channel = new BroadcastChannel(realtimeChannelName(target));

  try {
    const pb = await getAuthedPb();
    if (myGeneration !== generation) return; // superseded while awaiting auth

    const off = await pb.collection("annotations").subscribe<AnnotationData>(
      "*",
      (e: RecordSubscription<AnnotationData>) => {
        if (myGeneration !== generation) return; // stale subscription
        handleEvent(e);
      },
      { filter: pb.filter("target = {:target}", { target }) },
    );
    if (myGeneration !== generation) {
      // Retargeted again before this resolved -- undo immediately.
      off();
      return;
    }
    unsubscribe = off;
  } catch (err) {
    console.error("[sticky-party] orchestrator subscribe failed", err);
    if (myGeneration !== generation) return;
    const delay = INITIAL_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      setTimeout(
        () => subscribeTarget(target, myGeneration, attempt + 1),
        delay,
      );
    }
  }
}

// Target-scoped "histories" subscribe for the edit-history panel (see
// NoteFooter.tsx / entrypoints/annotation-iframe/useHistoryUpdates.ts).
// Separate subscribe() call from subscribeTarget's annotations one --
// two independent filters/callbacks are simpler than merging both
// collections' events through one handler -- but tied to the same
// per-target generation, so a stale response here is detected the same
// way.
async function subscribeTargetHistoryScoped(
  target: string,
  myGeneration: number,
  attempt = 0,
) {
  historyChannel = new BroadcastChannel(realtimeHistoryChannelName(target));

  try {
    const pb = await getAuthedPb();
    if (myGeneration !== generation) return;

    const off = await pb.collection("histories").subscribe<HistoryRecord>(
      "*",
      (e) => {
        if (myGeneration !== generation) return;
        historyChannel?.postMessage({
          record: {
            id: e.record.id,
            annotationId: e.record.annotationId,
            action: e.record.action,
            updated: e.record.updated,
            userName: e.record.userName || "unknown",
          },
        } satisfies RealtimeHistoryPayload);
      },
      { filter: pb.filter("target = {:target}", { target }) },
    );
    if (myGeneration !== generation) {
      off();
      return;
    }
    unsubscribeHistory = off;
  } catch (err) {
    console.error("[sticky-party] orchestrator history subscribe failed", err);
    if (myGeneration !== generation) return;
    const delay = INITIAL_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      setTimeout(
        () => subscribeTargetHistoryScoped(target, myGeneration, attempt + 1),
        delay,
      );
    }
  }
}

function handleEvent(e: RecordSubscription<AnnotationData>) {
  if (e.action === "update") {
    channel?.postMessage({ record: e.record } satisfies RealtimeUpdatePayload);
    // Relayed on every update (not just when currently pinned), since
    // content.ts also needs to detect the pin flag itself flipping --
    // see entrypoints/content/mountNote.ts's applyRemotePin. When
    // pin is false, xRatio/yRatio/width/height are simply the
    // annotation's stale pin* fields and are ignored on the receiving
    // end.
    window.parent.postMessage(
      {
        type: ANNOTATION_POSITION_UPDATED_MESSAGE,
        annotationId: e.record.id,
        pin: e.record.pin,
        xRatio: e.record.pinXRatio,
        yRatio: e.record.pinYRatio,
        width: e.record.pinWidth,
        height: e.record.pinHeight,
      } satisfies AnnotationPositionUpdatedMessage,
      "*",
    );
  } else if (e.action === "create") {
    window.parent.postMessage(
      {
        type: ANNOTATION_CREATED_MESSAGE,
        annotation: e.record,
      } satisfies AnnotationCreatedMessage,
      "*",
    );
  } else if (e.action === "delete") {
    window.parent.postMessage(
      {
        type: ANNOTATION_DELETED_MESSAGE,
        annotationId: e.record.id,
      } satisfies AnnotationDeletedMessage,
      "*",
    );
  }
}

// Subscribes once for the lifetime of this orchestrator iframe,
// independently of subscribeTarget's per-target lifecycle above: it is
// never torn down or re-subscribed when the page's matched target
// changes, since it exists purely to notice a target appearing
// *anywhere*, not just on this page (see docs/target-list-sync.md).
// Filtered server-side to "create" rows only -- update/delete rows
// don't represent a target newly gaining an annotation, so relaying
// them would only add noise to the local target cache (see
// entrypoints/background.ts's handling of ADD_CACHED_TARGET_MESSAGE).
async function subscribeTargetHistory(attempt = 0) {
  try {
    const pb = await getAuthedPb();
    await pb.collection("histories").subscribe<HistoryRecord>(
      "*",
      (e) => {
        if (!e.record.target) return;
        window.parent.postMessage(
          {
            type: TARGET_HISTORY_CREATED_MESSAGE,
            target: e.record.target,
            updated: e.record.updated,
          } satisfies TargetHistoryCreatedMessage,
          "*",
        );
      },
      { filter: "action = 'create'" },
    );
  } catch (err) {
    console.error("[sticky-party] target-history subscribe failed", err);
    const delay = INITIAL_RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      setTimeout(() => subscribeTargetHistory(attempt + 1), delay);
    }
  }
}

window.addEventListener(
  "message",
  (ev: MessageEvent<ParentToOrchestratorMessage>) => {
    if (ev.source !== window.parent) return;
    if (ev.data?.type === INIT_ORCHESTRATOR_MESSAGE) {
      teardown();
      generation++;
      subscribeTarget(ev.data.target, generation);
      subscribeTargetHistoryScoped(ev.data.target, generation);
    }
  },
);

subscribeTargetHistory();
window.parent.postMessage({ type: ORCHESTRATOR_READY_MESSAGE }, "*");
