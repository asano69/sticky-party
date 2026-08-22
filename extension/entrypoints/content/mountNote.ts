// Mounts a single sticky note as its own Extension iframe and owns
// everything that ties its interactive pieces together: the reactive
// note store that drives the wrapper's on-screen position/size/pin/z
// (see docs/note-sizing.md for the height formula), persisting that
// position to the backend, and applying position updates relayed by
// another viewer. The DOM chrome, drag gesture, resize gesture,
// viewport tracking, and iframe postMessage protocol are each their
// own module (see noteChrome.ts/noteDragging.ts/noteResizing.ts/
// noteViewportTracking.ts/noteIframeProtocol.ts) -- this file is the
// thin orchestrator that owns the shared state (the note store,
// xRatio/yRatio, positionRecordId) and wires those modules together.
// Extracted out of entrypoints/content/index.ts, which is kept as a
// thin entry point -- see that file's own header comment for why the
// iframe/parent split exists at all.
//
// Position/size/pin/z are all shared across every viewer now (see
// lib/positions.ts): x/y are stored as a ratio, but the ratio's basis
// depends on pin mode -- the whole document for a pinned note
// (position: absolute), the current viewport for an unpinned note
// (position: fixed). This matches how the browser actually anchors
// each mode: a fixed element is positioned relative to the viewport
// regardless of scroll, so basing its ratio on the much larger
// document size could place its header outside the viewport
// entirely, on any resolution, with no way to drag it back. Because
// the two modes use different bases, togglePin below has to actually
// convert top/left between them (accounting for scroll), not just
// flip a flag.
//
// The wrapper's on-screen appearance (position, size, pin mode,
// stacking order) is driven entirely by a single reactive `note`
// store below, applied to wrapper.style by one createEffect -- see
// docs/note-sizing.md for the height formula it implements. Every
// writer (drag, native resize, pin toggle, a remote position update)
// just patches the store; nothing outside that one effect touches
// wrapper.style.position/top/left/height/zIndex directly, so those
// five properties can never drift out of sync with each other.

import { createEffect, createRoot } from "solid-js";
import { createStore } from "solid-js/store";

import type { AnnotationData } from "../../lib/messages";
import type { Anchor } from "../../lib/positions";
import {
  NOTE_PIN_MESSAGE,
  TITLE_ROW_HEIGHT_PX,
  type NotePinMessage,
} from "../../lib/iframe-messages";
import { documentSize, remToPx, resolveOffset, viewportSize } from "./viewport";
import { animateMove } from "./moveAnimation";
import { removeFaded, removeShredded } from "./removeAnimation";
import { createPersistPosition, fetchInitialPosition } from "./notePosition";
import { buildNoteChrome } from "./noteChrome";
import { wireDragging } from "./noteDragging";
import { wireResizing } from "./noteResizing";
import { wireViewportTracking } from "./noteViewportTracking";
import { wireIframeProtocol } from "./noteIframeProtocol";

export const IFRAME_PAGE = "/annotation-iframe.html";

// z-index base kept well above host-page content but below the int32
// max, so it can keep counting up as notes are brought to front.
const Z_BASE = 2147480000;

// Dependencies mountNote needs from its caller (entrypoints/content/index.ts),
// so this file doesn't have to own any state shared across notes.
export interface MountNoteDeps {
  // Origin every postMessage exchange with this note's iframe is
  // validated against (see entrypoints/annotation-iframe.html).
  iframeOrigin: string;
  // Returns a fresh, ever-increasing z-index value.
  nextZ: () => number;
  // Advances the shared z counter to at least `z`, so a note restored
  // with an already-high z (from a saved position) doesn't get
  // immediately outranked by the next nextZ() call.
  bumpZCounter: (z: number) => void;
}

export async function mountNote(
  ctx: InstanceType<typeof ContentScriptContext>,
  annotation: AnnotationData,
  index: number,
  deps: MountNoteDeps,
) {
  const initial = await fetchInitialPosition({
    annotationId: annotation.id,
    // Cascade defaults, used only if this annotation has no saved
    // position yet.
    cascadeTop: 12 + index * 24,
    cascadeLeft: 12 + index * 24,
    nextZ: deps.nextZ,
    bumpZCounter: deps.bumpZCounter,
  });
  const { ratioState } = initial;

  // Everything the wrapper's on-screen appearance depends on --
  // position, pin mode, resting content height, whether the edit-mode
  // footer is showing, and stacking order -- lives in this one store.
  // A single createEffect below derives wrapper.style from it, so
  // every writer (this file, noteDragging.ts, noteResizing.ts,
  // noteViewportTracking.ts) just patches the store instead of
  // touching wrapper.style directly -- see this file's header comment
  // and docs/note-sizing.md for the height formula.
  const [note, setNote] = createStore({
    pinned: initial.pinned,
    top: initial.top,
    left: initial.left,
    // View-mode (preview) content height in px, restored from the
    // saved `height` field, or 0 for a brand-new note -- see
    // docs/note-sizing.md. This, not the wrapper's current on-screen
    // size, is what gets persisted (converted to rem).
    previewHeightPx: initial.previewHeightPx,
    // Edit-mode content height in px, footer included -- restored
    // from the saved `editorHeight` field, or 0 for a note that has
    // never been edited yet. Entirely separate from previewHeightPx
    // above, so the two never need to be reconciled against each
    // other (see docs/note-sizing.md).
    editorHeightPx: initial.editorHeightPx,
    // Whether previewHeightPx should keep auto-following the
    // content's natural size. Starts true for every note and flips to
    // false permanently the first time the native resize handle is
    // dragged (see noteResizing.ts) -- editorHeightPx is never gated
    // by this, it always follows the textarea.
    autoHeight: initial.autoHeight,
    editing: false,
    z: initial.z,
  });

  // Hoisted so applyRemotePosition (exposed on the returned handle)
  // can reach the wrapper element and cross-module cleanup functions
  // from outside onMount.
  let wrapperEl: HTMLElement | undefined;
  let isDragging: () => boolean = () => false;
  let isResizing: () => boolean = () => false;
  let cleanupChrome: (() => void) | undefined;
  let cleanupResizing: (() => void) | undefined;
  let cleanupViewportTracking: (() => void) | undefined;
  let cleanupIframeProtocol: (() => void) | undefined;
  // Disposes the createEffect below that derives wrapper.style from
  // the `note` store. Solid effects created outside a component tree
  // need an explicit owner (createRoot) and an explicit dispose call
  // once the note is unmounted -- otherwise the effect (and its
  // subscription to the store) would leak.
  let disposeNoteStyleEffect: (() => void) | undefined;

  const ui = createIframeUi(ctx, {
    page: IFRAME_PAGE,
    position: "inline",
    anchor: "html",
    onMount: (wrapper, iframe) => {
      wrapperEl = wrapper;

      // Derives the wrapper's position, size, pin mode, and stacking
      // order from the `note` store -- see this file's header
      // comment. This runs once immediately (Solid effects run on
      // creation, applying the initial state above) and again
      // automatically whenever any of the store's fields change.
      disposeNoteStyleEffect = createRoot((dispose) => {
        createEffect(() => {
          wrapper.style.position = note.pinned ? "absolute" : "fixed";
          wrapper.style.top = `${note.top}px`;
          wrapper.style.left = `${note.left}px`;
          // editorHeightPx already includes the footer (see
          // noteIframeProtocol.ts), so no separate footer term is
          // needed here -- just pick whichever of the two heights is
          // currently active.
          const contentPx = note.editing
            ? note.editorHeightPx
            : note.previewHeightPx;
          wrapper.style.height = `${TITLE_ROW_HEIGHT_PX + contentPx}px`;
          wrapper.style.zIndex = `${Z_BASE + note.z}`;
        });
        return dispose;
      });

      const persistPosition = createPersistPosition({
        annotationId: annotation.id,
        wrapper,
        ratioState,
        note,
      });

      const bringToFront = () => {
        setNote("z", deps.nextZ());
        // z is shared now, so a "bring to front" needs to reach every
        // viewer promptly, not just wait for the next drag/resize.
        persistPosition();
      };

      // Flips this note between following the viewport (fixed) and
      // staying anchored to a fixed spot on the page (absolute) --
      // triggered by the footer's pin button, relayed via
      // noteIframeProtocol.ts. Both modes now share the same
      // document-relative x/y (see this file's header comment), so
      // this is purely a metadata flip -- no coordinate conversion.
      const togglePin = () => {
        // note.top/note.left are pixel values in the *old* mode's
        // coordinate system (document-relative while absolute,
        // viewport-relative while fixed) -- switching position modes
        // without adjusting them would visually jump the note by the
        // current scroll offset. Converting here keeps the note
        // exactly where it was on screen at the moment of the toggle.
        const nextTop = note.pinned
          ? note.top - window.scrollY
          : note.top + window.scrollY;
        const nextLeft = note.pinned
          ? note.left - window.scrollX
          : note.left + window.scrollX;
        setNote({ pinned: !note.pinned, top: nextTop, left: nextLeft });
        persistPosition();
        iframe.contentWindow?.postMessage(
          { type: NOTE_PIN_MESSAGE, pin: note.pinned } satisfies NotePinMessage,
          deps.iframeOrigin,
        );
      };

      const chrome = buildNoteChrome({
        wrapper,
        iframe,
        initialWidthPx: initial.widthPx,
        onDismiss: () => playRemoveFaded(),
      });
      cleanupChrome = chrome.cleanup;

      const dragState = wireDragging({
        header: chrome.header,
        wrapper,
        iframe,
        iframeOrigin: deps.iframeOrigin,
        note,
        setNote,
        bringToFront,
        persistPosition,
      });
      isDragging = dragState.isDragging;

      const resizeState = wireResizing({
        wrapper,
        note,
        setNote,
        persistPosition,
      });
      isResizing = resizeState.isResizing;
      cleanupResizing = resizeState.cleanup;

      const viewportTracking = wireViewportTracking({
        ratioState,
        wrapper,
        note,
        setNote,
      });
      cleanupViewportTracking = viewportTracking.cleanup;

      const iframeProtocol = wireIframeProtocol({
        iframe,
        iframeOrigin: deps.iframeOrigin,
        annotation,
        header: chrome.header,
        note,
        setNote,
        removeLoadingOverlay: chrome.removeLoadingOverlay,
        bringToFront,
        togglePin,
        onDeleted: () => playRemoveShredded(),
      });
      cleanupIframeProtocol = iframeProtocol.cleanup;
    },
    onRemove: () => {
      cleanupIframeProtocol?.();
      cleanupChrome?.();
      cleanupResizing?.();
      cleanupViewportTracking?.();
      wrapperEl = undefined;
      disposeNoteStyleEffect?.();
      disposeNoteStyleEffect = undefined;
    },
  });

  // Applies a remote position/size/pin/z change relayed by the
  // realtime orchestrator (see entrypoints/content/index.ts's handling
  // of ANNOTATION_POSITION_UPDATED_MESSAGE) -- fired for every note
  // now that position is shared, not just pinned ones. Both pin modes
  // share the same document-relative x/y (see this file's header
  // comment), so unlike the old per-user version, there's no separate
  // "fetch my own saved position back" fallback needed on unpin: there
  // is only one shared position now, and it's already in `update`.
  function applyRemotePosition(update: {
    pin: boolean;
    anchorX: Anchor;
    anchorY: Anchor;
    x: number;
    y: number;
    width: number; // rem
    height: number; // rem
    autoHeight: boolean;
    z: number;
  }) {
    const wrapper = wrapperEl;
    if (!wrapper) return;
    // Ignore remote position updates while this note is actively
    // being dragged or resized -- including this client's own
    // self-echoed save from persistPosition (PocketBase realtime
    // always echoes a write back to its author). Without this guard,
    // a stale echo arriving mid-gesture snaps the note back to
    // wherever it was when that particular save fired, which reads as
    // the note jittering or hopping backward while being dragged or
    // resized.
    if (isDragging() || isResizing()) return;

    ratioState.xRatio = update.x;
    ratioState.yRatio = update.y;
    ratioState.anchorX = update.anchorX;
    ratioState.anchorY = update.anchorY;
    // Basis matches the pin mode this update carries -- see header
    // comment.
    const basis = update.pin ? documentSize() : viewportSize();
    const widthPx = remToPx(update.width);
    const heightPx = remToPx(update.height);
    const nextTop = resolveOffset(
      update.anchorY,
      update.y,
      basis.height,
      heightPx,
    );
    const nextLeft = resolveOffset(
      update.anchorX,
      update.x,
      basis.width,
      widthPx,
    );

    // Animates the visual move (and applies the new width) before
    // patching the note store: animateMove's FLIP technique needs to
    // read the wrapper's *current* on-screen position first, which the
    // note store's effect would otherwise instantly overwrite before
    // animateMove got a chance to measure it.
    animateMove(wrapper, nextTop, nextLeft);
    wrapper.style.width = `${widthPx}px`;

    setNote({
      pinned: update.pin,
      top: nextTop,
      left: nextLeft,
      previewHeightPx: Math.max(0, heightPx - TITLE_ROW_HEIGHT_PX),
      autoHeight: update.autoHeight,
      z: Math.max(note.z, update.z),
    });
  }

  // Wrappers around removeAnimation.ts's pure animation functions,
  // adding this note's own fallback (no wrapper mounted yet -> just
  // remove immediately) and the actual unmount call once the
  // animation finishes.
  function playRemoveFaded() {
    const wrapper = wrapperEl;
    if (!wrapper) {
      ui.remove();
      return;
    }
    removeFaded(wrapper, () => ui.remove());
  }

  function playRemoveShredded() {
    const wrapper = wrapperEl;
    if (!wrapper) {
      ui.remove();
      return;
    }
    removeShredded(wrapper, () => ui.remove());
  }

  ui.mount();
  return {
    ...ui,
    applyRemotePosition,
    removeFaded: playRemoveFaded,
    removeShredded: playRemoveShredded,
  };
}
