// Handles all window.postMessage traffic between this iframe and the
// parent content script (content.ts). See lib/iframe-messages.ts for
// the protocol definitions and the file-level comment in content.ts for
// why this iframe/parent split exists at all.

import { createEffect, onCleanup } from "solid-js";

import {
  INIT_NOTE_MESSAGE,
  NOTE_DELETED_MESSAGE,
  NOTE_EDITING_MESSAGE,
  NOTE_FOCUS_MESSAGE,
  NOTE_PIN_MESSAGE,
  NOTE_READY_MESSAGE,
  START_EDIT_TITLE_MESSAGE,
  TOGGLE_PIN_MESSAGE,
  type NoteEditingMessage,
  type ParentToNoteMessage,
} from "../../lib/iframe-messages";
import type { AnnotationData } from "../../lib/messages";

export function useParentMessaging(params: {
  onInit: (annotation: AnnotationData) => void;
  onStartEditTitle: () => void;
  editing: () => boolean;
  // Called when window focus leaves this iframe entirely while editing
  // (e.g. the user clicks elsewhere on the host page), mirroring the
  // old Shadow DOM version's focusout-to-save behavior. The caller owns
  // what "save" actually means (updateAnnotation + local state update).
  onBlurWhileEditing: () => void;
  // Called after every pin toggle, so the title row (NoteHeader.tsx)
  // can keep its left-padding in sync with whether content.ts is
  // currently drawing a pin button over that space -- see
  // NOTE_PIN_MESSAGE.
  onPinChange: (pin: boolean) => void;
}) {
  // Receive the annotation to render, a request to start editing the
  // title (relayed from a double-click on the content script's drag
  // header -- see content.ts), or a pin-state update.
  const onMessage = (e: MessageEvent<ParentToNoteMessage>) => {
    if (e.source !== window.parent) return;
    if (e.data?.type === INIT_NOTE_MESSAGE) params.onInit(e.data.annotation);
    else if (e.data?.type === START_EDIT_TITLE_MESSAGE)
      params.onStartEditTitle();
    else if (e.data?.type === NOTE_PIN_MESSAGE)
      params.onPinChange(e.data.pin);
  };
  window.addEventListener("message", onMessage);
  onCleanup(() => window.removeEventListener("message", onMessage));

  // Tell the content script this iframe is ready to receive its
  // annotation. Sent after the listener above is registered, so the
  // reply can never arrive before anything is listening for it.
  window.parent.postMessage({ type: NOTE_READY_MESSAGE }, "*");

  // Tell the content script whenever edit mode toggles, so its drag
  // header (see content.ts) can stop intercepting pointer events while
  // editing -- otherwise clicks could never reach the title input,
  // since that header overlays this iframe from a separate document.
  createEffect(() => {
    const nowEditing = params.editing();
    window.parent.postMessage(
      {
        type: NOTE_EDITING_MESSAGE,
        editing: nowEditing,
      } satisfies NoteEditingMessage,
      "*",
    );
  });

  const onWindowBlur = () => {
    if (params.editing()) params.onBlurWhileEditing();
  };
  window.addEventListener("blur", onWindowBlur);
  onCleanup(() => window.removeEventListener("blur", onWindowBlur));

  // Clicks inside this iframe don't bubble out to the wrapper's own
  // listeners (separate document), so focus must be reported
  // explicitly to let the content script bring this note to the front
  // of the stack.
  const sendFocus = () =>
    window.parent.postMessage({ type: NOTE_FOCUS_MESSAGE }, "*");

  // Sent once the annotation has been deleted from PocketBase, so the
  // content script can remove this note's wrapper from the page.
  const sendDeleted = () =>
    window.parent.postMessage({ type: NOTE_DELETED_MESSAGE }, "*");

  // Requests that content.ts toggle this note's pinned state (see
  // NoteFooter.tsx). Only content.ts can perform the actual toggle: it
  // needs the page's current scroll offset to convert between
  // fixed/absolute positioning, which this iframe has no access to
  // (see content.ts's togglePin). The resulting pin value comes back
  // separately via NOTE_PIN_MESSAGE (handled above in onMessage).
  const sendTogglePin = () =>
    window.parent.postMessage({ type: TOGGLE_PIN_MESSAGE }, "*");

  return { sendFocus, sendDeleted, sendTogglePin };
}
