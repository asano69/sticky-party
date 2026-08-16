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

// Sticky-note colors (light/dark) come from the --note-bg/--note-border/
// --note-text CSS variables in style.css, applied below via Tailwind's
// arbitrary-value syntax (e.g. bg-[color:var(--note-bg)]). Letting CSS
// handle prefers-color-scheme means this component doesn't need its own
// dark-mode signal or a palette object to switch between.

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
          class="flex h-full flex-col box-border bg-[color:var(--note-bg)] text-[color:var(--note-text)] font-[system-ui,-apple-system,sans-serif] text-[14px] leading-[1.4]"
        >
          {/* Sits directly under the content script's transparent drag
              header (see content.ts), which is exactly
              TITLE_ROW_HEIGHT_PX tall and overlays the Dismiss button on
              top of this row -- that's why the title text stops short of
              the row's right edge (padding-right below). Background is
              omitted here since it's already flat-opaque from the
              wrapper above. */}
          <div
            // Height stays inline (not a Tailwind class) since it must
            // stay tied to the TITLE_ROW_HEIGHT_PX constant -- a
            // hardcoded class here would be a second source of truth
            // that could drift from content.ts's drag-header overlay,
            // which this row has to line up with pixel-for-pixel.
            style={{ height: `${TITLE_ROW_HEIGHT_PX}px` }}
            class="flex shrink-0 items-center box-border pl-2 pr-8 font-bold border-b border-[color:var(--note-border)]"
          >
            <Show
              when={!editing()}
              fallback={
                <TextField
                  value={draftTitle()}
                  onChange={setDraftTitle}
                  disabled={saving()}
                  class="flex-1 min-w-0"
                >
                  <TextField.Input
                    ref={(el) => (titleInputRef = el)}
                    onKeyDown={onEditorKeyDown}
                    class="w-full box-border border-none bg-transparent font-[inherit] font-bold text-[color:var(--note-text)]"
                  />
                </TextField>
              }
            >
              <div class="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                {note().title}
              </div>
            </Show>
          </div>

          <div ref={(el) => (contentRef = el)} class="flex-1 overflow-auto px-2.5 py-1.5">
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
                    // min-h-full fills the main area even when the draft
                    // is short, instead of shrinking to hug just the text.
                    class="block w-full min-h-full box-border border-none resize-none overflow-hidden bg-transparent font-[inherit] text-[color:var(--note-text)]"
                  />
                </TextField>
              }
            >
              {/* min-h-full makes this fill the whole main area (not
                  just wrap the text), so double-clicking any blank space
                  below a short body still starts editing. */}
              <div
                onDblClick={(e) => {
                  e.preventDefault();
                  startEdit("body");
                }}
                class="min-h-full"
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
          {/* Background is omitted here too, for the same reason as the
              title row above -- it's already flat-opaque from the
              wrapper. */}
          <Show when={editing()}>
            <div
              // Height stays inline for the same reason as the title
              // row above: it must stay tied to TITLE_ROW_HEIGHT_PX.
              style={{ height: `${TITLE_ROW_HEIGHT_PX}px` }}
              class="flex shrink-0 items-center justify-start box-border px-2 border-t border-[color:var(--note-border)]"
            >
              <Button
                class="sticky-party-icon-btn flex items-center justify-center border-none bg-transparent cursor-pointer px-2 py-1.5 rounded"
                onMouseDown={(e: MouseEvent) => e.preventDefault()}
                onClick={handleDelete}
                disabled={deleting()}
                aria-label={confirmDelete() ? "Confirm delete" : "Delete"}
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
