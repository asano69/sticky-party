// Displays each matching annotation as its own sticky note (see
// entrypoints/content/AnnotationBoard.tsx), draggable and resizable, with
// Check (dismiss) and Edit (save) actions. All matching/fetching happens
// in the background script (see entrypoints/background.ts); this script
// only mounts what it's told.
//
// The overlay is mounted inside a shadow root (see createShadowRootUi
// below) so the host page's CSS can never leak in -- a page-wide `*`
// reset or an !important rule would otherwise still apply here, since
// inline styles only ever beat the page's own selector specificity, not
// !important.

import { render } from "solid-js/web";

import AnnotationBoard from "./content/AnnotationBoard";
import {
  CHECK_ANNOTATION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AnnotationData,
  type AnnotationMessage,
  type CheckAnnotationMessage,
} from "../lib/messages";

export default defineContentScript({
  matches: ["*://*/*"],
  async main(ctx) {
    // Annotations for the page currently being shown; read by onMount
    // below each time ui.mount() runs.
    let currentAnnotations: AnnotationData[] = [];

    const ui = await createShadowRootUi(ctx, {
      name: "sticky-party-overlay",
      position: "inline",
      anchor: "html",
      onMount(container) {
        // Draws the bullet marker for lines parsed as bullets by
        // lib/markup (see AnnotationBody.tsx). Injected once per mount
        // since every note in this overlay shares the same style scope.
        const style = document.createElement("style");
        style.textContent = `
          .sticky-party-bullet {
            position: relative;
            padding-left: 14px;
          }
          .sticky-party-bullet::before {
            content: "\u2022";
            position: absolute;
            left: 0;
            color: #000;
          }
          .sticky-party-icon-btn {
            background: transparent;
          }
          .sticky-party-icon-btn:hover {
            background-color: rgba(0, 0, 0, 0.15);
          }
        `;
        container.appendChild(style);

        return render(() => AnnotationBoard({ annotations: currentAnnotations }), container);
      },
      onRemove(dispose) {
        dispose?.();
      },
    });

    function showAnnotations(annotations: AnnotationData[]) {
      ui.remove();
      if (annotations.length === 0) return;
      currentAnnotations = annotations;
      ui.mount();
    }

    function hideOverlay() {
      ui.remove();
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
