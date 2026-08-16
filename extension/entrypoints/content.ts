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

import {
  CHECK_ANNOTATION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AnnotationData,
  type AnnotationMessage,
  type CheckAnnotationMessage,
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
import { fetchPosition, savePosition } from "../lib/positions";

const IFRAME_PAGE = "/annotation-iframe.html";

// z-index base kept well above host-page content but below the int32
// max, so it can keep counting up as notes are brought to front.
const Z_BASE = 2147480000;

export default defineContentScript({
  matches: ["*://*/*"],
  async main(ctx) {
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
        const saved = await fetchPosition(annotation.id);
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

      let resizeObserver: ResizeObserver | undefined;
      let resizeSaveTimer: ReturnType<typeof setTimeout> | undefined;
      let onMessage: ((e: MessageEvent) => void) | undefined;

      const ui = createIframeUi(ctx, {
        page: IFRAME_PAGE,
        position: "inline",
        anchor: "html",
        onMount: (wrapper, iframe) => {
          Object.assign(wrapper.style, {
            position: "fixed",
            top: `${top}px`,
            left: `${left}px`,
            width: savedWidth ? `${savedWidth}px` : "260px",
            minWidth: "160px",
            minHeight: "90px",
            resize: "both",
            overflow: "hidden",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
            zIndex: `${Z_BASE + z}`,
          });
          if (savedHeight) wrapper.style.height = `${savedHeight}px`;

          const bringToFront = () => {
            z = nextZ();
            wrapper.style.zIndex = `${Z_BASE + z}`;
          };

          const persistPosition = () => {
            savePosition(
              annotation.id,
              { top, left, width: wrapper.offsetWidth, height: wrapper.offsetHeight, z },
              positionRecordId,
            )
              .then((id) => (positionRecordId = id))
              .catch((err) => console.error("[sticky-party] failed to save position", err));
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

          const dismissBtn = document.createElement("button");
          dismissBtn.type = "button";
          dismissBtn.setAttribute("aria-label", "Dismiss");
          dismissBtn.textContent = "\u2715";
          Object.assign(dismissBtn.style, {
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
          let dragStart: { x: number; y: number; top: number; left: number } | null = null;
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
            iframe.contentWindow?.postMessage({ type: START_EDIT_TITLE_MESSAGE }, iframeOrigin);
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
              // Grow (or shrink back, once editing ends) the wrapper to
              // fit the iframe's content, restoring the old Shadow DOM
              // version's auto-growing textarea. The iframe fills the
              // wrapper, so resizing the wrapper resizes the iframe to
              // match; this also feeds the ResizeObserver below, which
              // persists the new size the same way a manual drag-resize
              // would.
              wrapper.style.height = `${TITLE_ROW_HEIGHT_PX + e.data.height}px`;
            } else if (e.data?.type === NOTE_EDITING_MESSAGE) {
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
