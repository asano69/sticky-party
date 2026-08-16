// Displays the annotation body sent by the background script as a
// fixed overlay in the top-right corner. All matching/fetching happens
// in the background script (see entrypoints/background.ts); this script
// only renders what it's told.

import {
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AnnotationMessage,
} from '../lib/messages';

export default defineContentScript({
  matches: ['*://*/*'],
  main() {
    // Lazily created on first message so pages without an annotation
    // never pay for an empty overlay element.
    let overlay: HTMLDivElement | undefined;

    function showOverlay(body: string) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'web-anno-overlay';
        Object.assign(overlay.style, {
          position: 'fixed',
          top: '12px',
          right: '12px',
          maxWidth: '280px',
          padding: '10px 14px',
          background: 'rgba(20, 20, 20, 0.9)',
          color: '#fff',
          fontSize: '13px',
          lineHeight: '1.4',
          borderRadius: '8px',
          zIndex: '2147483647',
          whiteSpace: 'pre-wrap',
        });
        document.documentElement.appendChild(overlay);
      }
      overlay.textContent = body;
    }

    function hideOverlay() {
      overlay?.remove();
      overlay = undefined;
    }

    browser.runtime.onMessage.addListener((message: AnnotationMessage) => {
      if (message?.type === SHOW_ANNOTATION_MESSAGE) {
        showOverlay(message.body);
      } else if (message?.type === HIDE_ANNOTATION_MESSAGE) {
        hideOverlay();
      }
    });
  },
});
