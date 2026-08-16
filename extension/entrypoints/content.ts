// Displays each matching annotation as its own separate overlay box,
// stacked top-to-bottom in the top-right corner (default position; each
// box is meant to become independently draggable later). All
// matching/fetching happens in the background script (see
// entrypoints/background.ts); this script only renders what it's told.

import {
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AnnotationMessage,
} from "../lib/messages";

export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    // Lazily created on first message so pages without an annotation
    // never pay for an empty container element.
    let container: HTMLDivElement | undefined;

    function ensureContainer() {
      if (container) return container;
      container = document.createElement("div");
      container.id = "web-anno-overlay";
      Object.assign(container.style, {
        position: "fixed",
        top: "12px",
        right: "12px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: "2147483647",
      });
      document.documentElement.appendChild(container);
      return container;
    }

    function showAnnotations(bodies: string[]) {
      hideOverlay();
      if (bodies.length === 0) return;

      const el = ensureContainer();
      for (const body of bodies) {
        const box = document.createElement("div");
        Object.assign(box.style, {
          maxWidth: "280px",
          padding: "10px 14px",
          background: "rgba(20, 20, 20, 0.9)",
          color: "#fff",
          fontSize: "13px",
          lineHeight: "1.4",
          borderRadius: "8px",
          whiteSpace: "pre-wrap",
        });
        box.textContent = body;
        el.appendChild(box);
      }
    }

    function hideOverlay() {
      container?.remove();
      container = undefined;
    }

    browser.runtime.onMessage.addListener((message: AnnotationMessage) => {
      if (message?.type === SHOW_ANNOTATION_MESSAGE) {
        showAnnotations(message.bodies);
      } else if (message?.type === HIDE_ANNOTATION_MESSAGE) {
        hideOverlay();
      }
    });
  },
});
