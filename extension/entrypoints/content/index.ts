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
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AddCachedTargetMessage,
  type AnnotationData,
  type AnnotationMessage,
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
import { log } from "../../lib/log";

export default defineContentScript({
  // "*://*/*" is kept here so WXT declares it as a host permission
  // (unchanged from before -- see wxt.config.ts's manifest comment),
  // but registration: "runtime" keeps it out of the manifest's static
  // content_scripts, so the browser no longer auto-injects this on
  // every page. Injection is instead driven entirely by
  // lib/dynamicContentScript.ts's registerContentScripts/
  // updateContentScripts calls, scoped to the local target cache.
  matches: ["*://*/*"],
  registration: "runtime",
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

    // Confirms the dynamically-registered content script (see
    // lib/dynamicContentScript.ts) actually ran on this page -- useful
    // for checking, from the page's own devtools console, whether a
    // given URL's match pattern was registered as expected.
    log.info("content script loaded", { url: location.href });

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

    // The annotation ids the most recent showAnnotations() call actually
    // wants mounted, and the ids currently being mounted (mountNote()
    // called but not yet resolved). Two overlapping showAnnotations()
    // calls are common -- e.g. opening the popup sends
    // RECHECK_ALL_TABS_MESSAGE, which can arrive while the page's own
    // initial mount is still awaiting its GET_POSITION_MESSAGE round
    // trip. Without pendingIds, the second call would start a duplicate
    // mountNote() for the same id; without checking wantedIds (rather
    // than a per-call generation number) on resolve, the first call's
    // mountNote() -- which already called ui.mount(), making the note
    // visible -- would be torn down again just because a later call had
    // since been issued, even though that later call wants the exact
    // same note. That combination is what made an already-visible note
    // flicker or vanish whenever the popup was opened.
    let wantedIds = new Set<string>();
    let pendingIds = new Set<string>();

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
      wantedIds = new Set(annotations.map((a) => a.id));

      for (const [id, ui] of mountedNotes) {
        if (wantedIds.has(id)) continue;
        ui.remove();
        mountedNotes.delete(id);
      }

      for (const [index, annotation] of annotations.entries()) {
        if (mountedNotes.has(annotation.id) || pendingIds.has(annotation.id)) {
          continue;
        }
        pendingIds.add(annotation.id);
        mountNote(ctx, annotation, index, mountNoteDeps).then((ui) => {
          pendingIds.delete(annotation.id);
          if (!wantedIds.has(annotation.id)) {
            ui.remove();
            return;
          }
          mountedNotes.set(annotation.id, ui);
        });
      }
    }

    function hideOverlay() {
      wantedIds = new Set();
      pendingIds = new Set();
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

    // No self-ping here anymore: this script is only ever injected by
    // background.ts's runCheckTab (see entrypoints/background.ts) after
    // it has already confirmed this page matches a cached target, and
    // only once the resulting SHOW_ANNOTATION_MESSAGE send is guaranteed
    // to reach the listener registered above. background.ts triggers
    // that check itself, directly off browser.tabs.onUpdated.
  },
});
