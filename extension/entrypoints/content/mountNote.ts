// Mounts a single sticky note as its own Extension iframe and wires up
// all of its on-page behavior: drag, resize, pin toggle, Dismiss,
// loading spinner, dark-mode colors, and the postMessage protocol with
// the iframe (see lib/iframe-messages.ts). Extracted out of
// entrypoints/content/index.ts, which is kept as a thin entry point --
// see that file's own header comment for why the iframe/parent split
// exists at all.
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
import X from "lucide-solid/icons/x";

import {
  GET_POSITION_MESSAGE,
  SAVE_POSITION_MESSAGE,
  type AnnotationData,
  type GetPositionMessage,
  type SavePositionMessage,
} from "../../lib/messages";
import {
  INIT_NOTE_MESSAGE,
  NOTE_CONTENT_RESIZE_MESSAGE,
  NOTE_DELETED_MESSAGE,
  NOTE_EDITING_MESSAGE,
  NOTE_FOCUS_MESSAGE,
  NOTE_PIN_MESSAGE,
  NOTE_READY_MESSAGE,
  START_EDIT_TITLE_MESSAGE,
  TITLE_ROW_HEIGHT_PX,
  TOGGLE_PIN_MESSAGE,
  type NotePinMessage,
} from "../../lib/iframe-messages";
import type { StoredPosition } from "../../lib/positions";
import { documentSize, pxToRem, remToPx, viewportSize } from "./viewport";
import { animateMove } from "./moveAnimation";
import { removeFaded, removeShredded } from "./removeAnimation";

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
  // Cascade defaults, used only if this annotation has no saved
  // position yet. Resolved before the note store below is created, so
  // the note appears directly at its saved spot instead of flashing at
  // the cascade position and then jumping once fetchPosition resolves.
  let initialTop = 12 + index * 24;
  let initialLeft = 12 + index * 24;
  let initialZ: number;
  let positionRecordId: string | undefined;
  let savedWidthPx: number | undefined;
  let initialPinned = false;
  // This note's anchor, as a ratio of the whole document -- the
  // source of truth for top/left regardless of pin mode (see this
  // file's header comment). Kept up to date by persistPosition and
  // the document ResizeObserver below. Deliberately plain variables,
  // not part of the `note` store below: they're the persisted-ratio
  // side of this note's position, a separate concern from what the
  // store renders (the current pixel position for the current basis).
  let xRatio = 0;
  let yRatio = 0;

  try {
    // Fetched via the background script, not directly here -- see
    // lib/messages.ts for why a content script can't safely call
    // PocketBase itself.
    const saved: StoredPosition | undefined = await browser.runtime.sendMessage(
      {
        type: GET_POSITION_MESSAGE,
        annotationId: annotation.id,
      } satisfies GetPositionMessage,
    );
    if (saved) {
      positionRecordId = saved.id;
      initialPinned = saved.pin;
      xRatio = saved.x;
      yRatio = saved.y;
      savedWidthPx = remToPx(saved.width);
      // Basis matches this note's pin mode -- see header comment.
      const basis = initialPinned ? documentSize() : viewportSize();
      initialTop = saved.y * basis.height;
      initialLeft = saved.x * basis.width;
      initialZ = saved.z;
      deps.bumpZCounter(initialZ);
    } else {
      initialZ = deps.nextZ();
    }
  } catch (err) {
    console.error("[sticky-party] failed to load position", err);
    initialZ = deps.nextZ();
  }

  if (positionRecordId === undefined) {
    // No saved position: derive the initial ratio from the cascade
    // default so the resize handling below has a sane anchor to work
    // from until the first persistPosition() call. A brand-new note
    // is never pinned yet, so this always uses the viewport basis.
    const basis = viewportSize();
    xRatio = basis.width ? initialLeft / basis.width : 0;
    yRatio = basis.height ? initialTop / basis.height : 0;
  }

  // Everything the wrapper's on-screen appearance depends on --
  // position, pin mode, resting content height, whether the edit-mode
  // footer is showing, and stacking order -- lives in this one store.
  // A single createEffect below (see onMount) derives wrapper.style
  // from it, so every writer in this file just patches the store
  // instead of touching wrapper.style directly -- see this file's
  // header comment and docs/note-sizing.md for the height formula.
  const [note, setNote] = createStore({
    pinned: initialPinned,
    top: initialTop,
    left: initialLeft,
    // Resting (non-editing) content height in px, as last reported by
    // the iframe via NOTE_CONTENT_RESIZE_MESSAGE (or recovered from a
    // manual drag-resize -- see the ResizeObserver below). This, not
    // the wrapper's current on-screen size, is what gets persisted
    // (converted to rem), so temporarily growing the wrapper for the
    // edit-mode footer never changes the note's saved size.
    contentHeightPx: 0,
    editing: false,
    z: initialZ,
  });

  let resizeObserver: ResizeObserver | undefined;
  // Set only while a native drag-resize gesture is in progress (see
  // the resizeObserver callback below); removes itself and calls
  // persistPosition() once the gesture's pointer is released, so the
  // final size is the only one ever sent to the backend -- no size
  // data is sent while the resize handle is still being dragged.
  let resizePointerUpListener: ((e: PointerEvent) => void) | undefined;
  // Fallback for resizePointerUpListener: the native resize handle's
  // drag is implemented by the browser itself, and in Chrome its
  // pointerup sometimes never reaches window (e.g. released outside
  // the viewport) -- without a fallback, `resizing` would then stay
  // true forever, permanently ignoring every future remote position
  // update for this note (see applyRemotePosition below). Reset on
  // every ResizeObserver callback; if it ever fires, the gesture is
  // treated as finished even though no pointerup was seen.
  let resizeEndTimer: ReturnType<typeof setTimeout> | undefined;
  const RESIZE_END_FALLBACK_MS = 500;
  // Redraws this note's on-screen position from xRatio/yRatio whenever
  // its basis changes -- document size for a pinned note, viewport
  // size for an unpinned one -- see this file's header comment and
  // the recomputePosition function below.
  let docResizeObserver: ResizeObserver | undefined;
  let docResizeTimer: ReturnType<typeof setTimeout> | undefined;
  let onWindowResize: (() => void) | undefined;
  let onMessage: ((e: MessageEvent) => void) | undefined;
  // Hoisted out of onMount so applyRemotePosition (defined below, and
  // exposed on the returned handle) can reach the wrapper element from
  // outside the onMount closure.
  let wrapperEl: HTMLElement | undefined;
  // Disposes the createEffect (created in onMount below) that derives
  // wrapper.style from the `note` store. Solid effects created outside
  // a component tree need an explicit owner (createRoot) and an
  // explicit dispose call once the note is unmounted (see onRemove) --
  // otherwise the effect (and its subscription to the store) would
  // leak.
  let disposeNoteStyleEffect: (() => void) | undefined;
  // Whether this note is currently mid-drag or mid-resize. While
  // either is true, applyRemotePosition ignores incoming updates --
  // including this client's own self-echoed save from persistPosition
  // (PocketBase realtime always echoes a write back to its author).
  // Without this guard, a stale echo arriving mid-gesture snaps the
  // note back to wherever it was when that particular save fired,
  // which reads as the note jittering or hopping backward while being
  // dragged or resized.
  let dragging = false;
  let resizing = false;
  // Captured the moment editing starts (see the NOTE_EDITING_MESSAGE
  // handler below): the note's resting content height right before
  // editing began. Used as a floor for NOTE_CONTENT_RESIZE_MESSAGE
  // while editing, so switching into edit mode never shrinks the note
  // down to whatever the textarea's own (possibly much smaller)
  // content happens to measure -- e.g. a note whose body is just an
  // attachment embed (![[id]]) is one line of raw markdown in the
  // textarea, but rendered much taller in view mode. Reset to
  // undefined once editing ends, so the next edit session starts from
  // a fresh floor instead of an earlier one.
  let editingFloorPx: number | undefined;
  // Tracks the media query used below to keep the Dismiss icon and
  // loading spinner colors in sync with the system color scheme,
  // and the listener function so it can be removed again in
  // onRemove.
  let darkModeQuery: MediaQueryList | undefined;
  let applyThemeColors: (() => void) | undefined;
  // Spinner overlay shown until the iframe reports its first
  // measured content height (see NOTE_CONTENT_RESIZE_MESSAGE
  // below), so the note shows a loading state instead of a blank
  // box while the iframe itself is still loading. Cleared to
  // undefined once removed, so later resize messages are a no-op.
  let loadingOverlay: HTMLDivElement | undefined;

  const ui = createIframeUi(ctx, {
    page: IFRAME_PAGE,
    position: "inline",
    anchor: "html",
    onMount: (wrapper, iframe) => {
      wrapperEl = wrapper;
      // Floor height for a single-line note: TITLE_ROW_HEIGHT_PX
      // (header) plus one line of body text with its vertical
      // padding (main's py-1.5 = 12px + one 14px/1.4 line ~= 20px).
      // Without this, main's flex-1 stretches to fill whatever
      // extra space a larger min-height forces, showing up as a
      // blank second line under single-line notes.
      const MIN_CONTENT_HEIGHT_PX = 32;
      // Static properties only -- never changed again after mount, so
      // they're set once here rather than through the note store's
      // effect below. Width in particular is also changed directly by
      // the browser's own native `resize: both` handle (see
      // resizeObserver below), which the store never learns about, so
      // it must stay outside the store-driven effect entirely.
      Object.assign(wrapper.style, {
        width: savedWidthPx ? `${savedWidthPx}px` : "260px",
        minWidth: "160px",
        minHeight: `${TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX}px`,
        resize: "both",
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
      });

      // Derives the wrapper's position, size, pin mode, and stacking
      // order from the `note` store -- see this file's header comment.
      // This runs once immediately (Solid effects run on creation,
      // applying the initial state above) and again automatically
      // whenever any of the store's fields change.
      disposeNoteStyleEffect = createRoot((dispose) => {
        createEffect(() => {
          wrapper.style.position = note.pinned ? "absolute" : "fixed";
          wrapper.style.top = `${note.top}px`;
          wrapper.style.left = `${note.left}px`;
          const footer = note.editing ? TITLE_ROW_HEIGHT_PX : 0;
          wrapper.style.height = `${TITLE_ROW_HEIGHT_PX + note.contentHeightPx + footer}px`;
          wrapper.style.zIndex = `${Z_BASE + note.z}`;
        });
        return dispose;
      });

      const bringToFront = () => {
        setNote("z", deps.nextZ());
        // z is shared now, so a "bring to front" needs to reach every
        // viewer promptly, not just wait for the next drag/resize.
        persistPosition();
      };

      // Saved via the background script, not directly here -- see
      // lib/messages.ts for why a content script can't safely call
      // PocketBase itself. Always recomputes xRatio/yRatio from the
      // note's current top/left before sending: this is the one place
      // a note's anchor is actually redefined (e.g. after a drag), so
      // the values the document ResizeObserver below relies on must
      // be refreshed here too.
      const persistPosition = () => {
        // Basis matches this note's current pin mode -- see header
        // comment.
        const basis = note.pinned ? documentSize() : viewportSize();
        xRatio = basis.width ? note.left / basis.width : xRatio;
        yRatio = basis.height ? note.top / basis.height : yRatio;
        browser.runtime
          .sendMessage({
            type: SAVE_POSITION_MESSAGE,
            annotationId: annotation.id,
            position: {
              pin: note.pinned,
              x: xRatio,
              y: yRatio,
              width: pxToRem(wrapper.offsetWidth),
              // Use contentHeightPx (the resting/non-editing size),
              // not wrapper.offsetHeight -- the wrapper is temporarily
              // taller than that while editing (see the store effect
              // above).
              height: pxToRem(TITLE_ROW_HEIGHT_PX + note.contentHeightPx),
              z: note.z,
            },
            existingId: positionRecordId,
          } satisfies SavePositionMessage)
          .then((id: string) => (positionRecordId = id))
          .catch((err: unknown) =>
            console.error("[sticky-party] failed to save position", err),
          );
      };

      // Flips this note between following the viewport (fixed) and
      // staying anchored to a fixed spot on the page (absolute) --
      // triggered by the footer's pin button (see
      // NoteFooter.tsx/TOGGLE_PIN_MESSAGE). Both modes now share the
      // same document-relative x/y (see this file's header comment),
      // so this is purely a metadata flip -- no coordinate conversion.
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

      // Transparent overlay pinned to the title row that
      // NoteContent.tsx renders inside the iframe (see
      // TITLE_ROW_HEIGHT_PX): it carries no note text of its own --
      // see entrypoints/content/index.ts's header comment for why --
      // but sits on top of the iframe so it can capture the drag and
      // the header double-click (relayed to the iframe as
      // START_EDIT_TITLE_MESSAGE below) while the title text shows
      // through from underneath. It's set pointer-events:none while
      // editing so clicks reach the title input inside the iframe
      // instead (see the NOTE_EDITING_MESSAGE handler below).
      const header = document.createElement("div");
      Object.assign(header.style, {
        position: "absolute",
        top: "0",
        left: "0",
        right: "0",
        height: `${TITLE_ROW_HEIGHT_PX}px`,
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
        boxSizing: "border-box",
        cursor: "grab",
        zIndex: "1",
      });

      // pointerEvents "none" so clicks (e.g. Dismiss) pass through
      // to the header underneath while this is still showing.
      loadingOverlay = document.createElement("div");
      Object.assign(loadingOverlay.style, {
        position: "absolute",
        inset: "0",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: "2",
      });
      const spinner = document.createElement("div");
      Object.assign(spinner.style, {
        width: "24px",
        height: "24px",
        borderRadius: "9999px",
        borderStyle: "solid",
        borderWidth: "4px",
      });
      spinner.animate(
        [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
        { duration: 800, iterations: Infinity, easing: "linear" },
      );
      loadingOverlay.append(spinner);
      wrapper.append(loadingOverlay);

      // The Dismiss icon (X) and the loading spinner both use fixed
      // colors instead of currentColor, since this wrapper is plain
      // DOM on the host page, not a Shadow DOM -- it has no access
      // to the --note-text variable from assets/theme.css. Set both
      // here, matching theme.css's palette, so they follow the
      // system color scheme instead of staying stuck at the host
      // page's default colors.
      darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
      applyThemeColors = () => {
        const dark = darkModeQuery!.matches;
        header.style.color = dark ? "#f5efc9" : "#3a3520";
        spinner.style.borderColor = dark ? "#404040" : "#e5e5e5";
        spinner.style.borderTopColor = dark ? "#d4d4d4" : "#737373";
      };
      applyThemeColors();
      darkModeQuery.addEventListener("change", applyThemeColors);

      const dismissBtn = document.createElement("button");
      dismissBtn.type = "button";
      dismissBtn.setAttribute("aria-label", "Dismiss");
      Object.assign(dismissBtn.style, {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        background: "transparent",
        borderRadius: "4px",
        cursor: "pointer",
        font: "inherit",
        lineHeight: "1",
        // Bigger touch target so the button doesn't look cramped
        // now that the header row is taller (TITLE_ROW_HEIGHT_PX).
        padding: "6px 8px",
        // Stays clickable even while the header above is
        // pointer-events:none during editing -- a child's own
        // pointer-events setting overrides its parent's.
        pointerEvents: "auto",
        // Pins this button to the header's right edge. It's this
        // header's only button now -- the pin toggle lives in the
        // footer instead (see NoteFooter.tsx) -- so marginLeft:
        // auto alone is enough to push it there.
        marginLeft: "auto",
      });
      // Solid components return a real DOM node when called directly
      // (no JSX/render() needed here), same icon as old-arch used.
      dismissBtn.appendChild(X({ size: 16 }) as unknown as Node);
      dismissBtn.addEventListener("mouseenter", () => {
        dismissBtn.style.background = "rgba(127, 127, 127, 0.35)";
      });
      dismissBtn.addEventListener("mouseleave", () => {
        dismissBtn.style.background = "transparent";
      });
      dismissBtn.addEventListener("click", () => playRemoveFaded());
      header.append(dismissBtn);
      wrapper.append(header);

      Object.assign(iframe.style, {
        border: "none",
        position: "absolute",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
      });

      // Dragging is tracked entirely in this document (never inside
      // the iframe), so pointer capture keeps working even if the
      // cursor briefly outruns the note during a fast drag -- an
      // iframe boundary would otherwise interrupt it.
      let dragStart: {
        x: number;
        y: number;
        top: number;
        left: number;
      } | null = null;
      header.addEventListener("pointerdown", (e) => {
        // Skip drag/capture when the pointerdown landed on the
        // Dismiss button: setPointerCapture below redirects all
        // subsequent pointer events (including the click derived
        // from pointerup) to the header, which otherwise silently
        // swallows the button's own click handler.
        if ((e.target as HTMLElement).closest("button")) return;
        dragging = true;
        bringToFront();
        dragStart = {
          x: e.clientX,
          y: e.clientY,
          top: note.top,
          left: note.left,
        };
        header.setPointerCapture(e.pointerId);
      });
      // Keeps the header row draggable within the currently visible
      // area, so it can never be dragged out where the user could no
      // longer grab it -- the actual root cause fixed separately (see
      // recomputePosition above) only guards against a stale saved
      // ratio; this guards the drag gesture itself, at the moment it
      // happens. Clamped against the viewport either way: even a
      // pinned (position: absolute) note is being dragged relative to
      // what the user can currently see, so the bound is the visible
      // viewport shifted by the current scroll offset, not the whole
      // document.
      //
      // Only the header's minimum horizontal visibility is enforced
      // (MIN_VISIBLE_PX), not the whole note width -- a note can be
      // wider than the viewport itself, so requiring full horizontal
      // visibility would make it impossible to drag at all in that
      // case. Vertically the full header height is enforced since
      // that's fixed at TITLE_ROW_HEIGHT_PX regardless of note width.
      const MIN_VISIBLE_PX = 40;
      const clampDragPosition = (nextTop: number, nextLeft: number) => {
        const offsetX = note.pinned ? window.scrollX : 0;
        const offsetY = note.pinned ? window.scrollY : 0;
        const maxTop = offsetY + window.innerHeight - TITLE_ROW_HEIGHT_PX;
        const minLeft = offsetX - (wrapper.offsetWidth - MIN_VISIBLE_PX);
        const maxLeft = offsetX + window.innerWidth - MIN_VISIBLE_PX;
        return {
          top: Math.min(Math.max(nextTop, offsetY), Math.max(maxTop, offsetY)),
          left: Math.min(Math.max(nextLeft, minLeft), Math.max(maxLeft, minLeft)),
        };
      };
      header.addEventListener("pointermove", (e) => {
        if (!dragStart) return;
        const next = clampDragPosition(
          dragStart.top + (e.clientY - dragStart.y),
          dragStart.left + (e.clientX - dragStart.x),
        );
        setNote({ top: next.top, left: next.left });
      });
      const endDrag = () => {
        if (!dragStart) return;
        dragStart = null;
        dragging = false;
        persistPosition();
      };
      header.addEventListener("pointerup", endDrag);
      header.addEventListener("pointercancel", endDrag);

      // Double-clicking the header outside the Dismiss button edits
      // the title. The title text itself lives inside the iframe
      // (see entrypoints/content/index.ts's header comment), so this
      // only relays the gesture -- NoteContent.tsx does the actual
      // editing.
      header.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        iframe.contentWindow?.postMessage(
          { type: START_EDIT_TITLE_MESSAGE },
          deps.iframeOrigin,
        );
      });

      // Resizing: the native CSS `resize: both` handle on `wrapper`
      // changes its size without firing a dedicated event, so a
      // ResizeObserver is used as the trigger instead, debounced so
      // a drag doesn't spam writes. The first observation (on
      // mount) is skipped since it isn't a resize.
      let skipNextResizeSave = true;
      resizeObserver = new ResizeObserver(() => {
        if (skipNextResizeSave) {
          skipNextResizeSave = false;
          return;
        }
        // Re-derive contentHeightPx from the wrapper's actual size, so
        // a manual drag-resize (which sets the wrapper's height
        // directly, bypassing the note store's effect above) updates
        // what gets persisted -- minus the edit-mode footer, if
        // currently editing, so the resting size stays footer-free
        // either way.
        const footer = note.editing ? TITLE_ROW_HEIGHT_PX : 0;
        setNote(
          "contentHeightPx",
          Math.max(0, wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX - footer),
        );

        // Ends the current resize gesture exactly once, however it was
        // detected (pointerup/pointercancel, or the fallback timer
        // below) -- guarded so a pointerup arriving right as the
        // fallback timer also fires can't run this twice.
        const endResize = () => {
          if (!resizing) return;
          resizing = false;
          if (resizePointerUpListener) {
            window.removeEventListener("pointerup", resizePointerUpListener);
            window.removeEventListener(
              "pointercancel",
              resizePointerUpListener,
            );
            resizePointerUpListener = undefined;
          }
          clearTimeout(resizeEndTimer);
          resizeEndTimer = undefined;
          persistPosition();
        };

        // Every observed change (including the first) pushes the
        // fallback timer back out, so it only fires once the resize
        // has actually gone quiet -- see RESIZE_END_FALLBACK_MS above.
        clearTimeout(resizeEndTimer);
        resizeEndTimer = setTimeout(endResize, RESIZE_END_FALLBACK_MS);

        if (resizing) return; // already waiting for this gesture to end

        // First observed change of a new resize gesture: nothing is
        // sent to the backend yet. Instead, wait for the native
        // resize handle's pointer to be released -- CSS `resize: both`
        // is handled entirely by the browser, so there is no
        // resize-start/resize-end event to listen to directly. A
        // window-level pointerup/pointercancel is the fastest signal
        // that the drag has finished; the fallback timer above covers
        // the case where that event never arrives (see its comment).
        resizing = true;
        resizePointerUpListener = endResize;
        window.addEventListener("pointerup", resizePointerUpListener);
        window.addEventListener("pointercancel", resizePointerUpListener);
      });
      resizeObserver.observe(wrapper);

      // A note's position is a ratio (xRatio/yRatio), not raw pixels,
      // so it must be recalculated whenever its basis changes: the
      // whole document for a pinned note, or the viewport for an
      // unpinned one (see this file's header comment). Document size
      // can shift as images, web fonts, or lazily-mounted content
      // change the page's layout; viewport size changes on an
      // ordinary browser window resize. Both are watched so a note
      // never drifts outside the visible area regardless of pin mode.
      // Debounced like resizeObserver above, since a page still
      // loading (or a window being dragged to resize) can fire many
      // times in quick succession.
      const recomputePosition = () => {
        const basis = note.pinned ? documentSize() : viewportSize();
        setNote({ top: yRatio * basis.height, left: xRatio * basis.width });
      };
      docResizeObserver = new ResizeObserver(() => {
        clearTimeout(docResizeTimer);
        docResizeTimer = setTimeout(recomputePosition, 300);
      });
      docResizeObserver.observe(document.documentElement);
      onWindowResize = () => {
        clearTimeout(docResizeTimer);
        docResizeTimer = setTimeout(recomputePosition, 300);
      };
      window.addEventListener("resize", onWindowResize);

      // Hand the annotation to the iframe once it reports itself
      // ready, rather than on the iframe's 'load' event -- 'load'
      // can fire before the iframe's own script has registered its
      // message listener, silently dropping the very first message.
      onMessage = (e) => {
        if (e.source !== iframe.contentWindow) return;
        if (e.data?.type === NOTE_READY_MESSAGE) {
          iframe.contentWindow?.postMessage(
            { type: INIT_NOTE_MESSAGE, annotation },
            deps.iframeOrigin,
          );
          // pin isn't part of AnnotationData (it lives in the
          // `positions` collection now, not `annotations` -- see
          // lib/positions.ts), so it's reported to the iframe
          // separately, right after init.
          iframe.contentWindow?.postMessage(
            {
              type: NOTE_PIN_MESSAGE,
              pin: note.pinned,
            } satisfies NotePinMessage,
            deps.iframeOrigin,
          );
        } else if (e.data?.type === NOTE_DELETED_MESSAGE) {
          playRemoveShredded();
        } else if (e.data?.type === NOTE_FOCUS_MESSAGE) {
          bringToFront();
        } else if (e.data?.type === NOTE_CONTENT_RESIZE_MESSAGE) {
          // Grow (or shrink back) the wrapper to fit the iframe's
          // main content, restoring the old Shadow DOM version's
          // auto-growing textarea. contentHeightPx (not the footer) is
          // what the note store's effect and persistPosition build on.
          // While editing, never go below editingFloorPx (see its
          // declaration above) -- this is what stops an existing note
          // from shrinking the instant editing starts.
          const height =
            editingFloorPx !== undefined
              ? Math.max(e.data.height, editingFloorPx)
              : e.data.height;
          setNote("contentHeightPx", height);
          // The iframe has now measured and reported real content,
          // so the note is actually showing something -- remove the
          // loading spinner. loadingOverlay is cleared right after,
          // so any later resize message is a no-op here.
          loadingOverlay?.remove();
          loadingOverlay = undefined;
        } else if (e.data?.type === NOTE_EDITING_MESSAGE) {
          // Capture (or release) the editing floor right as edit mode
          // toggles -- before this note's own contentHeightPx has any
          // chance to change, so the captured value is always the
          // resting (view-mode) height, never an already-shrunk one.
          editingFloorPx = e.data.editing ? note.contentHeightPx : undefined;
          setNote("editing", e.data.editing);
          // Grows the wrapper by the footer's height while editing
          // (see the note store's effect above), without touching
          // contentHeightPx -- so the note's saved size stays the
          // same whether or not the footer is currently showing.
          // Stop the header from intercepting pointer events while
          // editing, so clicks reach the title input inside the
          // iframe (see the header comment above).
          header.style.pointerEvents = e.data.editing ? "none" : "auto";
        } else if (e.data?.type === TOGGLE_PIN_MESSAGE) {
          // Requested by the footer's pin button (see
          // NoteFooter.tsx / useParentMessaging.ts's sendTogglePin).
          // Only content.ts can perform the actual toggle, since it
          // needs the page's current scroll offset to convert
          // between fixed/absolute positioning.
          togglePin();
        }
      };
      window.addEventListener("message", onMessage);
    },
    onRemove: () => {
      if (onMessage) window.removeEventListener("message", onMessage);
      if (darkModeQuery && applyThemeColors) {
        darkModeQuery.removeEventListener("change", applyThemeColors);
      }
      resizeObserver?.disconnect();
      if (resizePointerUpListener) {
        window.removeEventListener("pointerup", resizePointerUpListener);
        window.removeEventListener("pointercancel", resizePointerUpListener);
        resizePointerUpListener = undefined;
      }
      clearTimeout(resizeEndTimer);
      docResizeObserver?.disconnect();
      clearTimeout(docResizeTimer);
      if (onWindowResize) window.removeEventListener("resize", onWindowResize);
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
    x: number;
    y: number;
    width: number; // rem
    height: number; // rem
    z: number;
  }) {
    const wrapper = wrapperEl;
    if (!wrapper) return;
    // Ignore remote position updates while this note is actively
    // being dragged or resized -- see the `dragging`/`resizing`
    // declaration above for why.
    if (dragging || resizing) return;

    xRatio = update.x;
    yRatio = update.y;
    // Basis matches the pin mode this update carries -- see header
    // comment.
    const basis = update.pin ? documentSize() : viewportSize();
    const nextTop = update.y * basis.height;
    const nextLeft = update.x * basis.width;

    // Animates the visual move (and applies the new width) before
    // patching the note store: animateMove's FLIP technique needs to
    // read the wrapper's *current* on-screen position first, which the
    // note store's effect would otherwise instantly overwrite before
    // animateMove got a chance to measure it.
    animateMove(wrapper, nextTop, nextLeft);
    wrapper.style.width = `${remToPx(update.width)}px`;

    setNote({
      pinned: update.pin,
      top: nextTop,
      left: nextLeft,
      contentHeightPx: Math.max(
        0,
        remToPx(update.height) - TITLE_ROW_HEIGHT_PX,
      ),
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
