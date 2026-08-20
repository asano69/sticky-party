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
  type AnnotationCreatedMessage,
  type AnnotationDeletedMessage,
  type AnnotationPositionUpdatedMessage,
  type ParentToOrchestratorMessage,
  type RealtimeUpdatePayload,
} from "../../lib/realtime-messages";
import { realtimeChannelName } from "../../lib/realtime-channel";
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
// Bumped on every re-target, so a subscribe() call that resolves after
// a newer target has already taken over can detect it's stale and
// unsubscribe itself instead of delivering events for the wrong page.
let generation = 0;

function teardown() {
  unsubscribe?.();
  unsubscribe = undefined;
  channel?.close();
  channel = undefined;
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

window.addEventListener(
  "message",
  (ev: MessageEvent<ParentToOrchestratorMessage>) => {
    if (ev.source !== window.parent) return;
    if (ev.data?.type === INIT_ORCHESTRATOR_MESSAGE) {
      teardown();
      generation++;
      subscribeTarget(ev.data.target, generation);
    }
  },
);

window.parent.postMessage({ type: ORCHESTRATOR_READY_MESSAGE }, "*");
