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
  NOTE_MODE_MESSAGE,
  NOTE_READY_MESSAGE,
  START_EDIT_TITLE_MESSAGE,
  TOGGLE_POSITION_MODE_MESSAGE,
  type NoteEditingMessage,
  type ParentToNoteMessage,
} from "../../lib/iframe-messages";
import type { AnnotationData } from "../../lib/messages";
import type { PositionMode } from "../../lib/positions";

export function useParentMessaging(params: {
  onInit: (annotation: AnnotationData) => void;
  onStartEditTitle: () => void;
  editing: () => boolean;
  // Called when window focus leaves this iframe entirely while editing
  // (e.g. the user clicks elsewhere on the host page), mirroring the
  // old Shadow DOM version's focusout-to-save behavior. The caller owns
  // what "save" actually means (updateAnnotation + local state update).
  onBlurWhileEditing: () => void;
  // Called whenever content.ts reports this note's position mode (on
  // init, and again after every successful toggle -- see
  // NOTE_MODE_MESSAGE).
  onModeChange: (mode: PositionMode) => void;
}) {
  // Receive the annotation to render, a request to start editing the
  // title (relayed from a double-click on the content script's drag
  // header -- see content.ts), or a position-mode update.
  const onMessage = (e: MessageEvent<ParentToNoteMessage>) => {
    if (e.source !== window.parent) return;
    if (e.data?.type === INIT_NOTE_MESSAGE) params.onInit(e.data.annotation);
    else if (e.data?.type === START_EDIT_TITLE_MESSAGE)
      params.onStartEditTitle();
    else if (e.data?.type === NOTE_MODE_MESSAGE)
      params.onModeChange(e.data.mode);
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

  // Sent when the footer's pin button is clicked, asking content.ts to
  // flip this note between following the screen and staying anchored
  // to the page -- see TOGGLE_POSITION_MODE_MESSAGE.
  const sendToggleMode = () =>
    window.parent.postMessage({ type: TOGGLE_POSITION_MODE_MESSAGE }, "*");

  return { sendFocus, sendDeleted, sendToggleMode };
}
