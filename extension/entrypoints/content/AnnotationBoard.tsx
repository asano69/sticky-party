import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Trash, X } from "lucide-solid";
import { TextField } from "@kobalte/core/text-field";

import { deleteAnnotation, updateAnnotationBody } from "../../lib/annotations";
import type { AnnotationData } from "../../lib/messages";

// Sticky-note yellow, light and dark variants. Content scripts render
// into whatever page they're injected into, so they can't rely on the
// host page's own theme or CSS custom properties -- prefers-color-scheme
// is queried directly instead (see useIsDarkMode below).
const PALETTE = {
  light: {
    bg: "#fff8b8",
    border: "#e6d97a",
    text: "#3a3520",
    headerBorder: "rgba(0, 0, 0, 0.12)",
    buttonBorder: "rgba(0, 0, 0, 0.25)",
  },
  dark: {
    bg: "#4a4420",
    border: "#6b6230",
    text: "#f5efc9",
    headerBorder: "rgba(255, 255, 255, 0.15)",
    buttonBorder: "rgba(255, 255, 255, 0.3)",
  },
};

// Tracks prefers-color-scheme reactively so notes flip palette
// immediately if the OS/browser theme changes while the page is open.
function useIsDarkMode() {
  const query = matchMedia("(prefers-color-scheme: dark)");
  const [isDark, setIsDark] = createSignal(query.matches);
  const listener = (e: MediaQueryListEvent) => setIsDark(e.matches);
  query.addEventListener("change", listener);
  onCleanup(() => query.removeEventListener("change", listener));
  return isDark;
}

// Renders each matching annotation as an independent sticky note:
// draggable via its header, resizable via the native CSS `resize`
// handle, dismissible (Check) for the current page view, and editable
// (Edit) with changes saved back to PocketBase. Position/size and the
// dismissed state are session-only for now -- they reset the next time
// showAnnotations() runs (see entrypoints/content.ts) -- persistence is
// a later step.
export default function AnnotationBoard(props: { annotations: AnnotationData[] }) {
  // Shared stacking counter: initial z-index follows mount order (oldest
  // first, so the most recently edited note starts on top -- see
  // fetchAnnotations' `sort: 'updated'`), but after mount any note the
  // user interacts with (click, drag, edit) should jump above the rest.
  // A plain mutable counter (not a signal) is enough here since only
  // its next value is ever read, on demand, inside an event handler.
  let zCounter = props.annotations.length;
  const nextZ = () => ++zCounter;

  return (
    <For each={props.annotations}>
      {(annotation, index) => (
        <StickyNote annotation={annotation} index={index()} nextZ={nextZ} />
      )}
    </For>
  );
}

function StickyNote(props: { annotation: AnnotationData; index: number; nextZ: () => number }) {
  const isDark = useIsDarkMode();
  const palette = () => (isDark() ? PALETTE.dark : PALETTE.light);

  const [hidden, setHidden] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [body, setBody] = createSignal(props.annotation.body);
  const [draft, setDraft] = createSignal(props.annotation.body);
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);

  // Cascade the default position so multiple notes don't all land on top
  // of each other; from there the user can drag each one independently.
  // Anchored top/left (not top/right) so the native CSS `resize` handle
  // -- which always grows from the bottom-right corner of the box --
  // visually keeps the top-left corner fixed instead of appearing to
  // grow from the top-right.
  const [pos, setPos] = createSignal({
    top: 12 + props.index * 24,
    left: 12 + props.index * 24,
  });

  // Own stacking position, seeded from mount order. Any interaction with
  // this note (see bringToFront, wired to the note's onPointerDown below)
  // pulls a fresh, higher value from the shared counter so it visually
  // sits above every other note from then on.
  const [zIndex, setZIndex] = createSignal(props.index);
  const bringToFront = () => setZIndex(props.nextZ());

  let dragStart: { x: number; y: number; top: number; left: number } | null = null;

  const startDrag = (e: PointerEvent) => {
    // Skip drag/capture when the pointerdown originated on a button
    // (Edit/Check). Once this element captures the pointer, subsequent
    // pointer events -- and the mouseup/click events the browser derives
    // from them -- are redirected here too, so a captured header would
    // silently swallow clicks on its child buttons.
    if ((e.target as HTMLElement).closest("button")) return;
    dragStart = { x: e.clientX, y: e.clientY, ...pos() };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onDrag = (e: PointerEvent) => {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setPos({ top: dragStart.top + dy, left: dragStart.left + dx });
  };

  const endDrag = () => {
    dragStart = null;
  };

  let textareaRef: HTMLTextAreaElement | undefined;

  // Grows the textarea to fit its content (no internal scrollbar, no
  // fixed row count), so switching from the display div to the textarea
  // never changes the note's height.
  const resizeTextarea = () => {
    const el = textareaRef;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Re-measure whenever the draft text changes (typing, or the initial
  // value set by startEdit) and once editing mode actually mounts the
  // textarea.
  createEffect(() => {
    draft();
    if (editing()) resizeTextarea();
  });

  const startEdit = () => {
    setDraft(body());
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    setSaving(true);
    try {
      await updateAnnotationBody(props.annotation.id, draft());
      setBody(draft());
      setEditing(false);
    } catch (err) {
      console.error("[web-anno] failed to save annotation", err);
    } finally {
      setSaving(false);
    }
  };

  // Ctrl/Cmd+Enter saves, Esc cancels -- mirrors common textarea
  // conventions instead of dedicated Save/Cancel buttons.
  const onEditorKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      saveEdit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
    }
  };

  // Deletes the annotation from PocketBase and hides this note. The
  // local cached target list (lib/targets.ts) is deliberately left
  // alone: other annotations may still share the same target, so
  // pruning it here could hide notes that are still valid.
  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteAnnotation(props.annotation.id);
      setHidden(true);
    } catch (err) {
      console.error("[web-anno] failed to delete annotation", err);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Show when={!hidden()}>
      <div
        onPointerDown={bringToFront}
        style={{
          position: "fixed",
          top: `${pos().top}px`,
          left: `${pos().left}px`,
          width: "280px",
          "min-width": "160px",
          "min-height": "80px",
          resize: "both",
          overflow: "auto",
          background: palette().bg,
          border: `1px solid ${palette().border}`,
          color: palette().text,
          "font-size": "13px",
          "line-height": "1.4",
          "border-radius": "8px",
          "box-shadow": "0 2px 8px rgba(0, 0, 0, 0.25)",
          // Base offset keeps every note comfortably above host-page
          // content while leaving headroom below the int32 max, so
          // zIndex can keep counting up as notes are brought to front.
          "z-index": `${2147480000 + zIndex()}`,
        }}
      >
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          style={{
            display: "flex",
            "justify-content": editing() ? "space-between" : "flex-end",
            gap: "4px",
            padding: "6px 8px",
            cursor: "grab",
            "border-bottom": `1px solid ${palette().headerBorder}`,
          }}
        >
          {/* Only shown while editing, opposite the close button, so a
              casual dismiss click can never delete data by accident. */}
          <Show when={editing()}>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting()}
              aria-label="Delete"
              style={iconButtonStyle}
            >
              <Trash size={16} />
            </button>
          </Show>
          <button
            type="button"
            onClick={() => setHidden(true)}
            aria-label="Dismiss"
            style={iconButtonStyle}
          >
            <X size={16} />
          </button>
        </div>

        <Show
          when={!editing()}
          fallback={
            // Padding/margin/border here must exactly match the display
            // div below (and its content-mode style prop) -- any
            // difference shifts the text when toggling edit mode.
            <div style={{ padding: "10px 14px" }}>
              <TextField value={draft()} onChange={setDraft} disabled={saving()}>
                <TextField.TextArea
                  ref={(el) => {
                    textareaRef = el;
                    resizeTextarea();
                    // Focus explicitly: the textarea only mounts when edit
                    // mode starts (not on initial page load), so the native
                    // `autofocus` attribute is unreliable here. Deferred to
                    // a microtask so it runs after the dblclick's native
                    // "select word" default action settles; otherwise that
                    // default action can steal focus back, requiring a
                    // second click before typing actually works.
                    queueMicrotask(() => el.focus());
                  }}
                  rows={1}
                  onInput={resizeTextarea}
                  onKeyDown={onEditorKeyDown}
                  onFocusOut={saveEdit}
                  style={{
                    display: "block",
                    width: "100%",
                    margin: "0",
                    padding: "0",
                    border: "none",
                    "box-sizing": "border-box",
                    resize: "none",
                    overflow: "hidden",
                    "font": "inherit",
                    "line-height": "inherit",
                    background: "transparent",
                    color: palette().text,
                  }}
                />
              </TextField>
            </div>
          }
        >
          <div
            onDblClick={(e) => {
              // Prevent the native double-click "select word" behavior,
              // which otherwise runs after this handler and can steal
              // focus back from the textarea we're about to create.
              e.preventDefault();
              startEdit();
            }}
            style={{ padding: "10px 14px", "white-space": "pre-wrap" }}
          >
            {body()}
          </div>
        </Show>
      </div>
    </Show>
  );
}

const iconButtonStyle = {
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  border: "none",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  padding: "2px",
  "border-radius": "4px",
};

