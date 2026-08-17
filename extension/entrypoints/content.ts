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

import X from "lucide-solid/icons/x";

import {
  CHECK_ANNOTATION_MESSAGE,
  GET_POSITION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SAVE_POSITION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AnnotationData,
  type AnnotationMessage,
  type CheckAnnotationMessage,
  type GetPositionMessage,
  type SavePositionMessage,
} from "../lib/messages";
import {
  INIT_NOTE_MESSAGE,
  NOTE_CONTENT_RESIZE_MESSAGE,
  NOTE_DELETED_MESSAGE,
  NOTE_EDITING_MESSAGE,
  NOTE_FOCUS_MESSAGE,
  NOTE_READY_MESSAGE,
  START_EDIT_TITLE_MESSAGE,
  TITLE_ROW_HEIGHT_PX,
} from "../lib/iframe-messages";
import type { StoredPosition, ViewportInfo } from "../lib/positions";

// The content page's own viewport/screen at the moment of the call,
// read fresh each time rather than cached -- lib/positions.ts needs
// this because it runs in the background script (see that file's
// header comment), which has no access to this page's real
// `window`/`screen`.
function currentViewport(): ViewportInfo {
  return {
    windowWidth: window.innerWidth,
    windowHeight: window.innerHeight,
    screenWidth: screen.width,
    screenHeight: screen.height,
  };
}

const IFRAME_PAGE = "/annotation-iframe.html";

// z-index base kept well above host-page content but below the int32
// max, so it can keep counting up as notes are brought to front.
const Z_BASE = 2147480000;

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
    let mountedNotes: ReturnType<typeof mountNote>[] = [];

    // Shared stacking counter: each note starts at mount order, but any
    // note the user interacts with (drag, or a click inside its iframe)
    // jumps to a fresh, higher value so it visually sits above the rest.
    let zCounter = 0;
    const nextZ = () => ++zCounter;

    // Notes render at raw pixel offsets, but their saved position is a
    // ratio of the window's size (see lib/positions.ts's toRatio), so a
    // manual browser resize should keep each note in the same relative
    // spot instead of leaving it pinned to its old pixel offset.
    // Rescaling top/left by the window's size delta on every resize
    // keeps position/windowSize constant -- equivalent to reapplying
    // the original saved ratio -- so no DB round trip is needed here.
    const repositionOnResize = new Set<
      (scaleX: number, scaleY: number) => void
    >();
    let prevWindowWidth = window.innerWidth;
    let prevWindowHeight = window.innerHeight;
    window.addEventListener("resize", () => {
      const scaleX = window.innerWidth / prevWindowWidth;
      const scaleY = window.innerHeight / prevWindowHeight;
      prevWindowWidth = window.innerWidth;
      prevWindowHeight = window.innerHeight;
      for (const reposition of repositionOnResize) reposition(scaleX, scaleY);
    });

    async function mountNote(annotation: AnnotationData, index: number) {
      // Cascade defaults, used only if this device has no saved
      // position yet. Resolved before the iframe UI is created below,
      // so the note appears directly at its saved spot instead of
      // flashing at the cascade position and then jumping once
      // fetchPosition resolves (this mirrors old-arch's
      // `positionLoaded` gate, adapted for the iframe split).
      let top = 12 + index * 24;
      let left = 12 + index * 24;
      let z: number;
      let positionRecordId: string | undefined;
      let savedWidth: number | undefined;
      let savedHeight: number | undefined;

      try {
        // Fetched via the background script, not directly here -- see
        // lib/messages.ts for why a content script can't safely call
        // PocketBase itself.
        const saved: StoredPosition | undefined =
          await browser.runtime.sendMessage({
            type: GET_POSITION_MESSAGE,
            annotationId: annotation.id,
            viewport: currentViewport(),
          } satisfies GetPositionMessage);
        if (saved) {
          positionRecordId = saved.id;
          top = saved.top;
          left = saved.left;
          z = saved.z;
          savedWidth = saved.width;
          savedHeight = saved.height;
          if (z > zCounter) zCounter = z;
        } else {
          z = nextZ();
        }
      } catch (err) {
        console.error("[sticky-party] failed to load position", err);
        z = nextZ();
      }

      // Tracks the note's "resting" (non-editing) content height, as
      // last reported by the iframe via NOTE_CONTENT_RESIZE_MESSAGE (or
      // recovered from a manual drag-resize -- see the ResizeObserver
      // below). This, not the wrapper's current on-screen size, is what
      // gets persisted, so temporarily growing the wrapper for the
      // edit-mode footer (see applyWrapperHeight below) never changes
      // the note's saved size.
      let contentHeight = savedHeight ? savedHeight - TITLE_ROW_HEIGHT_PX : 0;
      let isEditingNote = false;

      let resizeObserver: ResizeObserver | undefined;
      let resizeSaveTimer: ReturnType<typeof setTimeout> | undefined;
      let onMessage: ((e: MessageEvent) => void) | undefined;
      let reposition: ((scaleX: number, scaleY: number) => void) | undefined;
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
          // Floor height for a single-line note: TITLE_ROW_HEIGHT_PX
          // (header) plus one line of body text with its vertical
          // padding (main's py-1.5 = 12px + one 14px/1.4 line ~= 20px).
          // Without this, main's flex-1 stretches to fill whatever
          // extra space a larger min-height forces, showing up as a
          // blank second line under single-line notes.
          const MIN_CONTENT_HEIGHT_PX = 32;
          Object.assign(wrapper.style, {
            position: "fixed",
            top: `${top}px`,
            left: `${left}px`,
            width: savedWidth ? `${savedWidth}px` : "260px",
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
          const applyWrapperHeight = () => {
            const footer = isEditingNote ? TITLE_ROW_HEIGHT_PX : 0;
            wrapper.style.height = `${TITLE_ROW_HEIGHT_PX + contentHeight + footer}px`;
          };
          applyWrapperHeight();

          // Keeps this note's screen position proportional to the
          // window when the browser window is resized (registered
          // into repositionOnResize above).
          reposition = (scaleX, scaleY) => {
            // top/left themselves stay pure ratio-scaled values, never
            // clamped -- clamping the state itself (not just the
            // rendered position) would permanently lose the note's true
            // position once the window shrinks far enough, so growing
            // the window back afterward could no longer restore it
            // exactly. Only the on-screen rendering is clamped here, so
            // top/left always scale back to their original values once
            // the window returns to its original size.
            top *= scaleY;
            left *= scaleX;
            const clampedTop = Math.min(
              Math.max(top, 0),
              Math.max(window.innerHeight - wrapper.offsetHeight, 0),
            );
            const clampedLeft = Math.min(
              Math.max(left, 0),
              Math.max(window.innerWidth - wrapper.offsetWidth, 0),
            );
            wrapper.style.top = `${clampedTop}px`;
            wrapper.style.left = `${clampedLeft}px`;
          };
          repositionOnResize.add(reposition);

          const bringToFront = () => {
            z = nextZ();
            wrapper.style.zIndex = `${Z_BASE + z}`;
          };

          const persistPosition = () => {
            // Saved via the background script, not directly here -- see
            // lib/messages.ts for why a content script can't safely call
            // PocketBase itself.
            browser.runtime
              .sendMessage({
                type: SAVE_POSITION_MESSAGE,
                annotationId: annotation.id,
                // Use contentHeight (the resting/non-editing size), not
                // wrapper.offsetHeight -- the wrapper is temporarily
                // taller than that while editing (see applyWrapperHeight
                // above).
                position: {
                  top,
                  left,
                  width: wrapper.offsetWidth,
                  height: TITLE_ROW_HEIGHT_PX + contentHeight,
                  z,
                },
                viewport: currentViewport(),
                existingId: positionRecordId,
              } satisfies SavePositionMessage)
              .then((id: string) => (positionRecordId = id))
              .catch((err: unknown) =>
                console.error("[sticky-party] failed to save position", err),
              );
          };

          // Transparent overlay pinned to the title row that
          // NoteContent.tsx renders inside the iframe (see
          // TITLE_ROW_HEIGHT_PX): it carries no note text of its own --
          // see the file-level comment above for why -- but sits on top
          // of the iframe so it can capture the drag and the header
          // double-click (relayed to the iframe as
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
            justifyContent: "flex-end",
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
          dismissBtn.addEventListener("click", () => ui.remove());
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
          // (see the file-level comment), so this only relays the
          // gesture -- NoteContent.tsx does the actual editing.
          header.addEventListener("dblclick", (e) => {
            if ((e.target as HTMLElement).closest("button")) return;
            iframe.contentWindow?.postMessage(
              { type: START_EDIT_TITLE_MESSAGE },
              iframeOrigin,
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

          // Hand the annotation to the iframe once it reports itself
          // ready, rather than on the iframe's 'load' event -- 'load'
          // can fire before the iframe's own script has registered its
          // message listener, silently dropping the very first message.
          onMessage = (e) => {
            if (e.source !== iframe.contentWindow) return;
            if (e.data?.type === NOTE_READY_MESSAGE) {
              iframe.contentWindow?.postMessage(
                { type: INIT_NOTE_MESSAGE, annotation },
                iframeOrigin,
              );
            } else if (e.data?.type === NOTE_DELETED_MESSAGE) {
              ui.remove();
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
            }
          };
          window.addEventListener("message", onMessage);
        },
        onRemove: () => {
          if (onMessage) window.removeEventListener("message", onMessage);
          if (reposition) repositionOnResize.delete(reposition);
          if (darkModeQuery && applyThemeColors) {
            darkModeQuery.removeEventListener("change", applyThemeColors);
          }
          resizeObserver?.disconnect();
          clearTimeout(resizeSaveTimer);
        },
      });

      ui.mount();
      return ui;
    }

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
        mountNote(annotation, index).then((ui) => {
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
