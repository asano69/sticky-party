// Displays each matching annotation as its own sticky note (see
// entrypoints/content/AnnotationBoard.tsx), draggable and resizable, with
// Check (dismiss) and Edit (save) actions. All matching/fetching happens
// in the background script (see entrypoints/background.ts); this script
// only mounts what it's told.

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
  main() {
    // Lazily created on first message so pages without an annotation
    // never pay for an empty container element.
    let container: HTMLDivElement | undefined;
    let dispose: (() => void) | undefined;

    function showAnnotations(annotations: AnnotationData[]) {
      hideOverlay();
      if (annotations.length === 0) return;

      container = document.createElement("div");
      container.id = "web-anno-overlay";
      document.documentElement.appendChild(container);
      dispose = render(() => AnnotationBoard({ annotations }), container);
    }

    function hideOverlay() {
      dispose?.();
      dispose = undefined;
      container?.remove();
      container = undefined;
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
