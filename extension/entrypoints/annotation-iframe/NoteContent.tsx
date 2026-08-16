import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import Trash from "lucide-solid/icons/trash";
import Shredder from "lucide-solid/icons/shredder";
import { TextField } from "@kobalte/core/text-field";
import { Button } from "@kobalte/core/button";

import { deleteAnnotation, updateAnnotation } from "../../lib/annotations";
import {
  INIT_NOTE_MESSAGE,
  NOTE_CONTENT_RESIZE_MESSAGE,
  NOTE_DELETED_MESSAGE,
  NOTE_EDITING_MESSAGE,
  NOTE_FOCUS_MESSAGE,
  NOTE_READY_MESSAGE,
  START_EDIT_TITLE_MESSAGE,
  TITLE_ROW_HEIGHT_PX,
  type NoteEditingMessage,
  type ParentToNoteMessage,
} from "../../lib/iframe-messages";
import type { AnnotationData } from "../../lib/messages";
import AnnotationBody from "./AnnotationBody";

// Sticky-note yellow, light and dark variants. This iframe renders into
// its own document, so it can't rely on the host page's theme or CSS
// custom properties -- prefers-color-scheme is queried directly.
const PALETTE = {
  light: { bg: "#fff8b8", text: "#3a3520", border: "rgba(0, 0, 0, 0.25)" },
  dark: { bg: "#4a4420", text: "#f5efc9", border: "rgba(255, 255, 255, 0.3)" },
};

function useIsDarkMode() {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const [isDark, setIsDark] = createSignal(query.matches);
  const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
  query.addEventListener("change", listener);
  onCleanup(() => query.removeEventListener("change", listener));
  return isDark;
}

// Renders a single sticky note's title, body, and edit/delete controls.
// Dragging, resizing, position persistence, and the Dismiss button live
// one level up in the content script (see entrypoints/content.ts) --
// this component only ever handles the note's title/body, and it's the
// only part of the UI that does, since it's the only part rendered
// inside the extension's own iframe rather than the host page's DOM.
export default function NoteContent() {
  const [annotation, setAnnotation] = createSignal<AnnotationData>();
  const [editing, setEditing] = createSignal(false);
  const [draftTitle, setDraftTitle] = createSignal("");
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  // Two-step delete: the first click only arms it (icon swaps to a
  // shredder as an "are you sure" cue); the actual delete fires on a
  // second click while armed.
  const [confirmDelete, setConfirmDelete] = createSignal(false);

  let titleInputRef: HTMLInputElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let contentRef: HTMLDivElement | undefined;

  const isDark = useIsDarkMode();
  const palette = () => (isDark() ? PALETTE.dark : PALETTE.light);

  const startEdit = (field: "title" | "body" = "body") => {
    const current = annotation();
    if (!current) return;
    setDraftTitle(current.title);
    setDraft(current.body);
    setConfirmDelete(false);
    setEditing(true);
    queueMicrotask(() => (field === "title" ? titleInputRef : textareaRef)?.focus());
  };

  // Grows the textarea to fit its content instead of scrolling inside a
  // fixed number of rows.
  const resizeTextarea = () => {
    const el = textareaRef;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Reports the note's full (unclipped) content height to the content
  // script so it can resize the wrapper element -- which lives in the
  // host page's document, not this iframe -- to fit. contentRef's
  // scrollHeight reflects the true content height even though it's
  // styled overflow:auto, since scrollHeight always includes content
  // that would otherwise be clipped/scrolled. Also used once editing
  // ends, so the wrapper shrinks back down instead of staying inflated
  // by the footer's height (footerRef?.offsetHeight is 0 once the
  // footer unmounts).
  // The footer (see the Show block below) is a flex sibling of
  // contentRef, not something contentRef's own scrollHeight measures, so
  // it never contributes to the note's required height -- only main's
  // own content does. content.ts (which owns the wrapper element) is
  // what temporarily adds the footer's height back in while editing.
  const reportContentHeight = () => {
    const height = contentRef?.scrollHeight ?? 0;
    window.parent.postMessage({ type: NOTE_CONTENT_RESIZE_MESSAGE, height }, "*");
  };

  // Re-measure whenever the draft text/title changes while editing, so
  // the wrapper keeps growing as the user types.
  createEffect(() => {
    draft();
    draftTitle();
    if (!editing()) return;
    resizeTextarea();
    queueMicrotask(reportContentHeight);
  });

  // Tell the content script whenever edit mode toggles, so its drag
  // header (see content.ts) can stop intercepting pointer events while
  // editing -- otherwise clicks could never reach the title input,
  // since that header overlays this iframe from a separate document.
  // Also re-report the content height once editing ends, so the
  // wrapper shrinks back down now that the footer is gone.
  let wasEditing = editing();
  createEffect(() => {
    const nowEditing = editing();
    window.parent.postMessage(
      { type: NOTE_EDITING_MESSAGE, editing: nowEditing } satisfies NoteEditingMessage,
      "*",
    );
    if (wasEditing && !nowEditing) queueMicrotask(reportContentHeight);
    wasEditing = nowEditing;
  });

  const cancelEdit = () => {
    setEditing(false);
    setConfirmDelete(false);
  };

  const saveEdit = async () => {
    const current = annotation();
    if (!current) return;
    setSaving(true);
    try {
      await updateAnnotation(current.id, { title: draftTitle(), body: draft() });
      setAnnotation({ ...current, title: draftTitle(), body: draft() });
      setEditing(false);
    } catch (err) {
      console.error("[sticky-party] failed to save annotation", err);
    } finally {
      setSaving(false);
    }
  };

  const onEditorKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete()) {
      setConfirmDelete(true);
      return;
    }
    const current = annotation();
    if (!current) return;
    setDeleting(true);
    try {
      await deleteAnnotation(current.id);
      window.parent.postMessage({ type: NOTE_DELETED_MESSAGE }, "*");
    } catch (err) {
      console.error("[sticky-party] failed to delete annotation", err);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  // Receive the annotation to render, or a request to start editing the
  // title (relayed from a double-click on the content script's drag
  // header -- see content.ts), from the content script.
  const onMessage = (e: MessageEvent<ParentToNoteMessage>) => {
    if (e.source !== window.parent) return;
    if (e.data?.type === INIT_NOTE_MESSAGE) setAnnotation(e.data.annotation);
    else if (e.data?.type === START_EDIT_TITLE_MESSAGE) startEdit("title");
  };
  window.addEventListener("message", onMessage);
  onCleanup(() => window.removeEventListener("message", onMessage));

  // Tell the content script this iframe is ready to receive its
  // annotation. Sent after the listener above is registered, so the
  // reply can never arrive before anything is listening for it.
  window.parent.postMessage({ type: NOTE_READY_MESSAGE }, "*");

  // Auto-save when focus leaves this iframe entirely (e.g. the user
  // clicks elsewhere on the host page) while editing, mirroring the old
  // focusout-to-save behavior from the Shadow DOM version.
  const onWindowBlur = () => {
    if (editing()) saveEdit();
  };
  window.addEventListener("blur", onWindowBlur);
  onCleanup(() => window.removeEventListener("blur", onWindowBlur));

  return (
    <Show when={annotation()}>
      {(note) => (
        <div
          // Clicks inside this iframe don't bubble out to the wrapper's
          // own listeners (separate document), so report focus
          // explicitly to let the content script bring this note to
          // the front of the stack.
          onPointerDown={() => window.parent.postMessage({ type: NOTE_FOCUS_MESSAGE }, "*")}
          style={{
            display: "flex",
            "flex-direction": "column",
            height: "100%",
            "box-sizing": "border-box",
            background: palette().bg,
            color: palette().text,
            "font-family": "system-ui, -apple-system, sans-serif",
            "font-size": "14px",
            "line-height": "1.4",
          }}
        >
          {/* Sits directly under the content script's transparent drag
              header (see content.ts), which is exactly
              TITLE_ROW_HEIGHT_PX tall and overlays the Dismiss button on
              top of this row -- that's why the title text stops short of
              the row's right edge (padding-right below). */}
          <div
            // Extension doesn't wire up a Tailwind build (see wxt.config.ts),
            // so this stays plain inline style rather than utility classes.
            // Height matches TITLE_ROW_HEIGHT_PX so this row (rendered
            // inside the iframe) lines up pixel-for-pixel with the
            // content script's transparent drag-header overlay (see
            // content.ts). Right padding leaves room for that overlay's
            // (larger) Dismiss button.
            style={{
              height: `${TITLE_ROW_HEIGHT_PX}px`,
              "flex-shrink": "0",
              "box-sizing": "border-box",
              display: "flex",
              "align-items": "center",
              padding: "0 32px 0 8px",
              "font-weight": "700",
              background: palette().bg,
              "border-bottom": `1px solid ${palette().border}`,
            }}
          >
            <Show
              when={!editing()}
              fallback={
                <TextField
                  value={draftTitle()}
                  onChange={setDraftTitle}
                  disabled={saving()}
                  style={{ flex: "1", "min-width": "0" }}
                >
                  <TextField.Input
                    ref={(el) => (titleInputRef = el)}
                    onKeyDown={onEditorKeyDown}
                    style={{
                      width: "100%",
                      "box-sizing": "border-box",
                      border: "none",
                      background: "transparent",
                      font: "inherit",
                      "font-weight": "700",
                      color: palette().text,
                    }}
                  />
                </TextField>
              }
            >
              <div
                style={{
                  width: "100%",
                  "min-width": "0",
                  overflow: "hidden",
                  "text-overflow": "ellipsis",
                  "white-space": "nowrap",
                }}
              >
                {note().title}
              </div>
            </Show>
          </div>

          <div ref={(el) => (contentRef = el)} style={{ flex: "1", overflow: "auto", padding: "6px 10px" }}>
            <Show
              when={!editing()}
              fallback={
                <TextField value={draft()} onChange={setDraft} disabled={saving()}>
                  <TextField.TextArea
                    ref={(el) => {
                      textareaRef = el;
                      resizeTextarea();
                    }}
                    rows={1}
                    onInput={resizeTextarea}
                    onKeyDown={onEditorKeyDown}
                    style={{
                      display: "block",
                      width: "100%",
                      // Fills the main area even when the draft is short,
                      // instead of shrinking to hug just the text.
                      "min-height": "100%",
                      "box-sizing": "border-box",
                      border: "none",
                      resize: "none",
                      overflow: "hidden",
                      background: "transparent",
                      font: "inherit",
                      color: palette().text,
                    }}
                  />
                </TextField>
              }
            >
              {/* min-height 100% makes this fill the whole main area
                  (not just wrap the text), so double-clicking any blank
                  space below a short body still starts editing. */}
              <div
                onDblClick={(e) => {
                  e.preventDefault();
                  startEdit("body");
                }}
                style={{ "min-height": "100%" }}
              >
                <AnnotationBody body={note().body} />
              </div>
            </Show>
          </div>

          {/* Footer only appears while editing, so a casual click can
              never delete data by accident. It's a normal flex item
              appended below main, not counted in main's own height:
              content.ts temporarily grows the note's wrapper by exactly
              TITLE_ROW_HEIGHT_PX while editing to make room for it, and
              reportContentHeight above never includes it, so the note's
              saved/resting size is unaffected either way. */}
          <Show when={editing()}>
            <div
              style={{
                "flex-shrink": "0",
                height: `${TITLE_ROW_HEIGHT_PX}px`,
                "box-sizing": "border-box",
                display: "flex",
                "align-items": "center",
                "justify-content": "flex-start",
                padding: "0 8px",
                background: palette().bg,
                "border-top": `1px solid ${palette().border}`,
              }}
            >
              <Button
                class="sticky-party-icon-btn"
                onMouseDown={(e: MouseEvent) => e.preventDefault()}
                onClick={handleDelete}
                disabled={deleting()}
                aria-label={confirmDelete() ? "Confirm delete" : "Delete"}
                style={{
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  border: "none",
                  background: "transparent",
                  cursor: "pointer",
                  padding: "6px 8px",
                  "border-radius": "4px",
                }}
              >
                <Show when={confirmDelete()} fallback={<Trash size={16} />}>
                  <Shredder size={16} />
                </Show>
              </Button>
            </div>
          </Show>
        </div>
      )}
    </Show>
  );
}
