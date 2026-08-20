// Mounts a single sticky note as its own Extension iframe and wires up
// all of its on-page behavior: drag, resize, pin toggle, Dismiss,
// loading spinner, dark-mode colors, and the postMessage protocol with
// the iframe (see lib/iframe-messages.ts). Extracted out of
// entrypoints/content/index.ts, which is kept as a thin entry point --
// see that file's own header comment for why the iframe/parent split
// exists at all.
//
// Position/size/pin/z are all shared across every viewer now (see
// lib/positions.ts): x/y are stored as a ratio of the whole document,
// used as-is whether the note is pinned (position: absolute) or not
// (position: fixed) -- the two modes only differ in how the browser
// then renders that anchor as the page scrolls, not in how the anchor
// itself is computed or stored. That's what makes togglePin below a
// pure metadata flip with no coordinate math.

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
import { documentSize, pxToRem, remToPx } from "./viewport";
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
  // position yet. Resolved before the iframe UI is created below, so
  // the note appears directly at its saved spot instead of flashing at
  // the cascade position and then jumping once fetchPosition resolves.
  let top = 12 + index * 24;
  let left = 12 + index * 24;
  let z: number;
  let positionRecordId: string | undefined;
  let savedWidthPx: number | undefined;
  // Whether this note follows the viewport (position: fixed, the
  // default) or stays anchored to a fixed spot on the page (position:
  // absolute). Shared across every viewer via the `positions`
  // collection (see lib/positions.ts) -- no longer per-user.
  let pinned = false;
  // This note's anchor, as a ratio of the whole document -- the
  // source of truth for top/left regardless of pinned (see this
  // file's header comment). Kept up to date by persistPosition and
  // the document ResizeObserver below.
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
      pinned = saved.pin;
      xRatio = saved.x;
      yRatio = saved.y;
      savedWidthPx = remToPx(saved.width);
      const doc = documentSize();
      top = saved.y * doc.height;
      left = saved.x * doc.width;
      z = saved.z;
      deps.bumpZCounter(z);
    } else {
      z = deps.nextZ();
    }
  } catch (err) {
    console.error("[sticky-party] failed to load position", err);
    z = deps.nextZ();
  }

  if (positionRecordId === undefined) {
    // No saved position: derive the initial ratio from the cascade
    // default so the document-resize observer below has a sane anchor
    // to work from until the first persistPosition() call.
    const doc = documentSize();
    xRatio = doc.width ? left / doc.width : 0;
    yRatio = doc.height ? top / doc.height : 0;
  }

  // Tracks the note's "resting" (non-editing) content height in px, as
  // last reported by the iframe via NOTE_CONTENT_RESIZE_MESSAGE (or
  // recovered from a manual drag-resize -- see the ResizeObserver
  // below). This, not the wrapper's current on-screen size, is what
  // gets persisted (converted to rem), so temporarily growing the
  // wrapper for the edit-mode footer (see applyWrapperHeight below)
  // never changes the note's saved size.
  let contentHeight = savedWidthPx !== undefined ? 0 : 0;
  let isEditingNote = false;

  let resizeObserver: ResizeObserver | undefined;
  let resizeSaveTimer: ReturnType<typeof setTimeout> | undefined;
  // Watches the whole document so this note's on-screen position can
  // be redrawn from xRatio/yRatio whenever the document's size changes,
  // for any reason (window resize, images/fonts finishing loading,
  // lazily-mounted content). Applies to every note now, pinned or
  // not -- see this file's header comment.
  let docResizeObserver: ResizeObserver | undefined;
  let docResizeTimer: ReturnType<typeof setTimeout> | undefined;
  let onMessage: ((e: MessageEvent) => void) | undefined;
  // Hoisted out of onMount so applyRemotePosition (defined below, and
  // exposed on the returned handle) can reach the wrapper element and
  // its height-recalculation logic from outside the onMount closure.
  let wrapperEl: HTMLElement | undefined;
  let applyWrapperHeight: (() => void) | undefined;
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
      Object.assign(wrapper.style, {
        // A pinned note uses absolute positioning so it stays put
        // in the document flow and scrolls with the page; an
        // ordinary note (default) uses fixed so it stays put on
        // screen instead.
        position: pinned ? "absolute" : "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: savedWidthPx ? `${savedWidthPx}px` : "260px",
        minWidth: "160px",
        minHeight: `${TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX}px`,
        resize: "both",
        overflow: "hidden",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
        zIndex: `${Z_BASE + z}`,
      });

      // Sets the wrapper's total height from contentHeight, plus
      // TITLE_ROW_HEIGHT_PX for the edit-mode footer whenever the
      // note is being edited (see NOTE_EDITING_MESSAGE below). The
      // footer's extra space is purely visual -- persistPosition
      // never includes it (see below) -- so entering/leaving edit
      // mode never changes the note's saved size.
      applyWrapperHeight = () => {
        const footer = isEditingNote ? TITLE_ROW_HEIGHT_PX : 0;
        wrapper.style.height = `${TITLE_ROW_HEIGHT_PX + contentHeight + footer}px`;
      };
      applyWrapperHeight();

      const bringToFront = () => {
        z = deps.nextZ();
        wrapper.style.zIndex = `${Z_BASE + z}`;
        // z is shared now, so a "bring to front" needs to reach every
        // viewer promptly, not just wait for the next drag/resize.
        persistPosition();
      };

      // Saved via the background script, not directly here -- see
      // lib/messages.ts for why a content script can't safely call
      // PocketBase itself. Always recomputes xRatio/yRatio from the
      // current top/left before sending: this is the one place a
      // note's anchor is actually redefined (e.g. after a drag), so
      // the values the document ResizeObserver below relies on must
      // be refreshed here too.
      const persistPosition = () => {
        const doc = documentSize();
        xRatio = doc.width ? left / doc.width : xRatio;
        yRatio = doc.height ? top / doc.height : yRatio;
        browser.runtime
          .sendMessage({
            type: SAVE_POSITION_MESSAGE,
            annotationId: annotation.id,
            position: {
              pin: pinned,
              x: xRatio,
              y: yRatio,
              width: pxToRem(wrapper.offsetWidth),
              // Use contentHeight (the resting/non-editing size), not
              // wrapper.offsetHeight -- the wrapper is temporarily
              // taller than that while editing (see applyWrapperHeight
              // above).
              height: pxToRem(TITLE_ROW_HEIGHT_PX + contentHeight),
              z,
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
        pinned = !pinned;
        wrapper.style.position = pinned ? "absolute" : "fixed";
        persistPosition();
        iframe.contentWindow?.postMessage(
          { type: NOTE_PIN_MESSAGE, pin: pinned } satisfies NotePinMessage,
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
        bringToFront();
        dragStart = { x: e.clientX, y: e.clientY, top, left };
        header.setPointerCapture(e.pointerId);
      });
      header.addEventListener("pointermove", (e) => {
        if (!dragStart) return;
        top = dragStart.top + (e.clientY - dragStart.y);
        left = dragStart.left + (e.clientX - dragStart.x);
        wrapper.style.top = `${top}px`;
        wrapper.style.left = `${left}px`;
      });
      const endDrag = () => {
        if (!dragStart) return;
        dragStart = null;
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
        // Re-derive contentHeight from the wrapper's actual size, so
        // a manual drag-resize (which sets the wrapper's height
        // directly, bypassing applyWrapperHeight) updates what gets
        // persisted -- minus the edit-mode footer, if currently
        // editing, so the resting size stays footer-free either way.
        const footer = isEditingNote ? TITLE_ROW_HEIGHT_PX : 0;
        contentHeight = Math.max(
          0,
          wrapper.offsetHeight - TITLE_ROW_HEIGHT_PX - footer,
        );
        clearTimeout(resizeSaveTimer);
        resizeSaveTimer = setTimeout(persistPosition, 300);
      });
      resizeObserver.observe(wrapper);

      // A pinned note's position is a ratio of the whole document
      // (pinRatioX/pinRatioY), not raw pixels, so it must be
      // recalculated whenever the document's size changes -- not
      // just on window resize, but also as images, web fonts, or
      // lazily-mounted content shift the page's layout after this
      // script first ran. Watching documentElement catches all of
      // these causes uniformly, instead of trying to guess the one
      // "correct" moment to measure once. Debounced like
      // resizeObserver above, since a page still loading can
      // resize many times in quick succession.

      // Redraws top/left from xRatio/yRatio whenever the document's
      // size changes, for every note (see this file's header
      // comment) -- not just pinned ones as before.
      docResizeObserver = new ResizeObserver(() => {
        clearTimeout(docResizeTimer);
        docResizeTimer = setTimeout(() => {
          const doc = documentSize();
          top = yRatio * doc.height;
          left = xRatio * doc.width;
          wrapper.style.top = `${top}px`;
          wrapper.style.left = `${left}px`;
        }, 300);
      });
      docResizeObserver.observe(document.documentElement);

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
            { type: NOTE_PIN_MESSAGE, pin: pinned } satisfies NotePinMessage,
            deps.iframeOrigin,
          );
        } else if (e.data?.type === NOTE_DELETED_MESSAGE) {
          playRemoveShredded();
        } else if (e.data?.type === NOTE_FOCUS_MESSAGE) {
          bringToFront();
        } else if (e.data?.type === NOTE_CONTENT_RESIZE_MESSAGE) {
          // Grow (or shrink back) the wrapper to fit the iframe's
          // main content, restoring the old Shadow DOM version's
          // auto-growing textarea. contentHeight (not the footer) is
          // what applyWrapperHeight and persistPosition build on.
          contentHeight = e.data.height;
          applyWrapperHeight();
          // The iframe has now measured and reported real content,
          // so the note is actually showing something -- remove the
          // loading spinner. loadingOverlay is cleared right after,
          // so any later resize message is a no-op here.
          loadingOverlay?.remove();
          loadingOverlay = undefined;
        } else if (e.data?.type === NOTE_EDITING_MESSAGE) {
          isEditingNote = e.data.editing;
          // Grows the wrapper by the footer's height while editing
          // (see applyWrapperHeight above), without touching
          // contentHeight -- so the note's saved size stays the same
          // whether or not the footer is currently showing.
          applyWrapperHeight();
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
      clearTimeout(resizeSaveTimer);
      docResizeObserver?.disconnect();
      clearTimeout(docResizeTimer);
      wrapperEl = undefined;
      applyWrapperHeight = undefined;
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
    const applyHeight = applyWrapperHeight;
    if (!wrapper || !applyHeight) return;

    pinned = update.pin;
    xRatio = update.x;
    yRatio = update.y;
    const doc = documentSize();
    top = update.y * doc.height;
    left = update.x * doc.width;
    contentHeight = Math.max(0, remToPx(update.height) - TITLE_ROW_HEIGHT_PX);
    z = Math.max(z, update.z);

    wrapper.style.position = pinned ? "absolute" : "fixed";
    wrapper.style.zIndex = `${Z_BASE + z}`;
    animateMove(wrapper, top, left);
    wrapper.style.width = `${remToPx(update.width)}px`;
    applyHeight();
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
