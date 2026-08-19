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
  CHECK_ANNOTATION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AnnotationData,
  type AnnotationMessage,
  type CheckAnnotationMessage,
} from "../../lib/messages";
import { createResizeRegistry } from "./viewport";
import { IFRAME_PAGE, mountNote } from "./mountNote";

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

    // The notes currently on screen. Replaced wholesale on every
    // SHOW_ANNOTATION_MESSAGE, mirroring the old AnnotationBoard.
    let mountedNotes: Awaited<ReturnType<typeof mountNote>>[] = [];

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

    // Notes render at raw pixel offsets, but their saved position is a
    // ratio of the window's size (see lib/positions.ts's toRatio), so a
    // manual browser resize should keep each note in the same relative
    // spot instead of leaving it pinned to its old pixel offset.
    // createResizeRegistry (see ./viewport) owns the actual resize
    // listeners and rescale math; mountNote just adds/removes its own
    // reposition callback from the returned Set.
    const repositionOnResize = createResizeRegistry();

    const mountNoteDeps = { iframeOrigin, repositionOnResize, nextZ, bumpZCounter };

    // Bumped on every showAnnotations/hideOverlay call so a mountNote()
    // that resolves after a newer call has already run (e.g. the user
    // navigated away while its position fetch was in flight) can detect
    // it's stale and remove itself instead of appearing for the wrong
    // page.
    let showGeneration = 0;

    function showAnnotations(annotations: AnnotationData[]) {
      hideOverlay();
      const generation = ++showGeneration;
      for (const [index, annotation] of annotations.entries()) {
        mountNote(ctx, annotation, index, mountNoteDeps).then((ui) => {
          if (generation !== showGeneration) {
            ui.remove();
            return;
          }
          mountedNotes.push(ui);
        });
      }
    }

    function hideOverlay() {
      showGeneration++;
      for (const ui of mountedNotes) ui.remove();
      mountedNotes = [];
    }

    browser.runtime.onMessage.addListener((message: AnnotationMessage) => {
      if (message?.type === SHOW_ANNOTATION_MESSAGE) {
        showAnnotations(message.annotations);
      } else if (message?.type === HIDE_ANNOTATION_MESSAGE) {
        hideOverlay();
      }
    });

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
