// Displays each matching annotation as its own sticky note: draggable
// and resizable, with a Dismiss button and an Edit/Delete flow.
//
// Each note is mounted as its own Extension iframe (see
// entrypoints/annotation-iframe.html and annotation-iframe/) instead of
// a Shadow DOM node. A Shadow Root still shares this document, so its
// DOM -- and therefore the note's title/body text -- is technically
// inspectable by the host page. An iframe pointed at the extension's
// own origin is a genuinely separate document the host page cannot
// read, so all of a note's actual text lives there.
//
// Everything that stays in this document (position, size, the drag
// handle, the Dismiss button) carries no note content, so there's
// nothing sensitive to leak even though it isn't isolated.
//
// Because the content script and the iframe are separate
// documents/origins, they can't share JS state directly the way a
// Shadow Root UI could -- they talk over window.postMessage instead,
// using the small protocol in lib/iframe-messages.ts.
//
// This file is kept as a thin entry point: it owns the state shared
// across every mounted note (the notes list, the z-index counter, the
// resize-reposition registry) and wires up the top-level message
// listeners. A single note's own DOM lifecycle (drag, resize, pin
// toggle, Dismiss, loading spinner, iframe protocol) lives in
// ./mountNote instead -- see that file for the actual per-note logic.

import {
  ADD_CACHED_TARGET_MESSAGE,
  CHECK_ANNOTATION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AddCachedTargetMessage,
  type AnnotationData,
  type AnnotationMessage,
  type CheckAnnotationMessage,
} from "../../lib/messages";
import {
  ANNOTATION_CREATED_MESSAGE,
  ANNOTATION_DELETED_MESSAGE,
  ANNOTATION_POSITION_UPDATED_MESSAGE,
  TARGET_HISTORY_CREATED_MESSAGE,
  type OrchestratorToParentMessage,
} from "../../lib/realtime-messages";
import { IFRAME_PAGE, mountNote } from "./mountNote";
import { mountOrchestrator, ORCHESTRATOR_PAGE } from "./mountOrchestrator";

export default defineContentScript({
  matches: ["*://*/*"],
  async main(ctx) {
    // Guard against double-mounting: dev-mode HMR can re-run this script
    // in the same page without a full reload, which would otherwise
    // register duplicate listeners and mount duplicate sticky notes.
    // The flag lives on `window` since that's the one object shared
    // across re-injections into the same document.
    const w = window as typeof window & {
      __stickyPartyContentLoaded?: boolean;
    };
    if (w.__stickyPartyContentLoaded) return;
    w.__stickyPartyContentLoaded = true;

    // Extension pages only accept a postMessage whose targetOrigin
    // matches their own origin; every note's iframe shares this origin.
    const iframeOrigin = new URL(browser.runtime.getURL(IFRAME_PAGE)).origin;

    // The notes currently on screen, keyed by annotation id -- a Map
    // (not a plain array) so a realtime delete relay from the
    // orchestrator (see below) can remove exactly the right note.
    let mountedNotes = new Map<string, Awaited<ReturnType<typeof mountNote>>>();

    // Realtime: one orchestrator iframe per page-with-notes, kept alive
    // across repeated showAnnotations() calls for the *same* target
    // (SSE reconnects are expensive -- see docs/realtime-sync.md). The
    // orchestrator's own iframe is separate from every note's
    // annotation-iframe, so it isn't touched by hideOverlay()'s note
    // teardown unless the target itself stops matching.
    const orchestratorOrigin = new URL(
      browser.runtime.getURL(ORCHESTRATOR_PAGE),
    ).origin;
    let orchestrator: ReturnType<typeof mountOrchestrator> | undefined;
    let orchestratorTarget: string | undefined;

    // Mounts the orchestrator iframe if needed and (re-)subscribes it
    // to `target`. Reuses the existing iframe when the target hasn't
    // changed, instead of tearing it down and reconnecting.
    function ensureOrchestrator(target: string) {
      if (orchestrator && orchestratorTarget === target) return;
      orchestratorTarget = target;
      if (!orchestrator) {
        orchestrator = mountOrchestrator(ctx, { orchestratorOrigin });
        orchestrator.ui.mount();
      }
      orchestrator.sendInit(target);
    }

    function teardownOrchestrator() {
      orchestrator?.ui.remove();
      orchestrator = undefined;
      orchestratorTarget = undefined;
    }

    // Shared stacking counter: each note starts at mount order, but any
    // note the user interacts with (drag, or a click inside its iframe)
    // jumps to a fresh, higher value so it visually sits above the rest.
    let zCounter = 0;
    const nextZ = () => ++zCounter;
    // Advances zCounter to at least `z`, so a note restored with an
    // already-high z (from a saved position) doesn't get immediately
    // outranked by the next nextZ() call. See ./mountNote's use of this
    // when it loads a saved position.
    const bumpZCounter = (z: number) => {
      if (z > zCounter) zCounter = z;
    };

    const mountNoteDeps = {
      iframeOrigin,
      nextZ,
      bumpZCounter,
    };

    // Bumped on every showAnnotations/hideOverlay call so a mountNote()
    // that resolves after a newer call has already run (e.g. the user
    // navigated away while its position fetch was in flight) can detect
    // it's stale and remove itself instead of appearing for the wrong
    // page.
    let showGeneration = 0;

    // Reconciles the mounted note set against `annotations` instead of
    // blindly tearing everything down and remounting: notes whose id is
    // no longer present get removed, notes whose id is still present are
    // left mounted untouched, and only genuinely new ids get mounted.
    // This is what lets a popup save that adds a second (or later) note
    // to an already-matching page mount just that one note, instead of
    // destroying and recreating every note already on screen (losing
    // drag position mid-interaction, restarting each note's iframe,
    // etc.). It also still handles a target change correctly, since
    // removal is based on annotation id membership, not on `target`
    // itself.
    function showAnnotations(annotations: AnnotationData[], target: string) {
      ensureOrchestrator(target);
      const generation = ++showGeneration;
      const incomingIds = new Set(annotations.map((a) => a.id));

      for (const [id, ui] of mountedNotes) {
        if (incomingIds.has(id)) continue;
        ui.remove();
        mountedNotes.delete(id);
      }

      for (const [index, annotation] of annotations.entries()) {
        if (mountedNotes.has(annotation.id)) continue;
        mountNote(ctx, annotation, index, mountNoteDeps).then((ui) => {
          if (generation !== showGeneration) {
            ui.remove();
            return;
          }
          mountedNotes.set(annotation.id, ui);
        });
      }
    }

    function hideOverlay() {
      showGeneration++;
      for (const ui of mountedNotes.values()) ui.remove();
      mountedNotes = new Map();
      teardownOrchestrator();
    }

    browser.runtime.onMessage.addListener((message: AnnotationMessage) => {
      if (message?.type === SHOW_ANNOTATION_MESSAGE) {
        showAnnotations(message.annotations, message.target);
      } else if (message?.type === HIDE_ANNOTATION_MESSAGE) {
        hideOverlay();
      }
    });

    // Relays from the orchestrator iframe: another user created or
    // deleted an annotation for this page's target. Only this document
    // can act on these since it owns the note wrapper elements --
    // "update" events skip this entirely and go straight to the
    // matching note's own iframe via BroadcastChannel (see
    // lib/realtime-channel.ts and NoteContent.tsx).
    window.addEventListener(
      "message",
      (e: MessageEvent<OrchestratorToParentMessage>) => {
        if (e.source !== orchestrator?.getWindow()) return;
        if (e.data?.type === ANNOTATION_CREATED_MESSAGE) {
          const annotation = e.data.annotation;
          mountNote(ctx, annotation, mountedNotes.size, mountNoteDeps).then(
            (ui) => mountedNotes.set(annotation.id, ui),
          );
        } else if (e.data?.type === ANNOTATION_DELETED_MESSAGE) {
          mountedNotes.get(e.data.annotationId)?.removeShredded();
          mountedNotes.delete(e.data.annotationId);
        } else if (e.data?.type === ANNOTATION_POSITION_UPDATED_MESSAGE) {
          mountedNotes.get(e.data.annotationId)?.applyRemotePosition({
            pin: e.data.pin,
            x: e.data.x,
            y: e.data.y,
            width: e.data.width,
            height: e.data.height,
            z: e.data.z,
          });
        } else if (e.data?.type === TARGET_HISTORY_CREATED_MESSAGE) {
          // Not scoped to this page's own target -- just forwarded on
          // to background.ts, which owns the local target cache (see
          // lib/targets.ts and entrypoints/background.ts).
          browser.runtime.sendMessage({
            type: ADD_CACHED_TARGET_MESSAGE,
            target: e.data.target,
            updated: e.data.updated,
          } satisfies AddCachedTargetMessage);
        }
      },
    );

    // Ask the background script to check this page as soon as this
    // script starts. tabs.onUpdated in entrypoints/background.ts already
    // checks on navigation, but it can fire before this script finishes
    // injecting, and a message sent to a tab with no listener yet is
    // silently dropped. Without this ping, that race meant a matching
    // page's annotation only ever showed up after a second navigation.
    browser.runtime.sendMessage({
      type: CHECK_ANNOTATION_MESSAGE,
      url: location.href,
    } satisfies CheckAnnotationMessage);
  },
});
