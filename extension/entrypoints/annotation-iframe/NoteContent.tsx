import { createSignal, onCleanup, Show } from "solid-js";
import Trash from "lucide-solid/icons/trash";
import Shredder from "lucide-solid/icons/shredder";
import { TextField } from "@kobalte/core/text-field";
import { Button } from "@kobalte/core/button";

import { deleteAnnotation, updateAnnotation } from "../../lib/annotations";
import {
  INIT_NOTE_MESSAGE,
  NOTE_DELETED_MESSAGE,
  NOTE_FOCUS_MESSAGE,
  NOTE_READY_MESSAGE,
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

  const isDark = useIsDarkMode();
  const palette = () => (isDark() ? PALETTE.dark : PALETTE.light);

  const startEdit = () => {
    const current = annotation();
    if (!current) return;
    setDraftTitle(current.title);
    setDraft(current.body);
    setConfirmDelete(false);
    setEditing(true);
    queueMicrotask(() => titleInputRef?.focus());
  };

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

  // Receive the annotation to render from the content script.
  const onMessage = (e: MessageEvent<ParentToNoteMessage>) => {
    if (e.source !== window.parent) return;
    if (e.data?.type === INIT_NOTE_MESSAGE) setAnnotation(e.data.annotation);
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
          <div style={{ flex: "1", overflow: "auto", padding: "6px 10px" }}>
            <Show
              when={!editing()}
              fallback={
                <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
                  <TextField value={draftTitle()} onChange={setDraftTitle} disabled={saving()}>
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
                  <TextField value={draft()} onChange={setDraft} disabled={saving()}>
                    <TextField.TextArea
                      rows={4}
                      onKeyDown={onEditorKeyDown}
                      style={{
                        width: "100%",
                        "box-sizing": "border-box",
                        border: "none",
                        resize: "none",
                        background: "transparent",
                        font: "inherit",
                        color: palette().text,
                      }}
                    />
                  </TextField>
                </div>
              }
            >
              <div onDblClick={startEdit} style={{ "font-weight": "700", "margin-bottom": "4px" }}>
                {note().title}
              </div>
              <div onDblClick={startEdit}>
                <AnnotationBody body={note().body} />
              </div>
            </Show>
          </div>

          {/* Footer only appears while editing, so a casual click can
              never delete data by accident. */}
          <Show when={editing()}>
            <div
              style={{
                display: "flex",
                "justify-content": "flex-start",
                padding: "4px 8px",
                "border-top": `1px solid ${palette().border}`,
              }}
            >
              <Button
                class="sticky-party-icon-btn"
                onMouseDown={(e: MouseEvent) => e.preventDefault()}
                onClick={handleDelete}
                disabled={deleting()}
                aria-label={confirmDelete() ? "Confirm delete" : "Delete"}
                style={{ border: "none", cursor: "pointer", padding: "2px", "border-radius": "4px" }}
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
