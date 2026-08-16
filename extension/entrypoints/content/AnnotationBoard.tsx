import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import Trash from "lucide-solid/icons/trash";
import Shredder from "lucide-solid/icons/shredder";
import X from "lucide-solid/icons/x";
import { TextField } from "@kobalte/core/text-field";

import { deleteAnnotation, updateAnnotation } from "../../lib/annotations";
import { fetchPosition, savePosition } from "../../lib/positions";
import type { AnnotationData } from "../../lib/messages";
import AnnotationBody from "./AnnotationBody";

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
  // Called once a note's persisted z-index loads, so the shared counter
  // never falls behind a value already restored from storage -- otherwise
  // bringToFront's next() could hand out a z lower than a note that was
  // already on top before reload.
  const reportZ = (z: number) => {
    if (z > zCounter) zCounter = z;
  };

  return (
    <For each={props.annotations}>
      {(annotation, index) => (
        <StickyNote annotation={annotation} index={index()} nextZ={nextZ} reportZ={reportZ} />
      )}
    </For>
  );
}

function StickyNote(props: { annotation: AnnotationData; index: number; nextZ: () => number }) {
  const isDark = useIsDarkMode();
  const palette = () => (isDark() ? PALETTE.dark : PALETTE.light);

  const [hidden, setHidden] = createSignal(false);
  // Starts false so the note isn't rendered at its default (cascaded,
  // top-left-ish) position while fetchPosition is still in flight in
  // onMount below. Flipped to true once loading finishes -- whether or
  // not a saved position was actually found -- so a note with no saved
  // position still appears (at its default) instead of staying hidden
  // forever.
  const [positionLoaded, setPositionLoaded] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [title, setTitle] = createSignal(props.annotation.title);
  const [draftTitle, setDraftTitle] = createSignal(props.annotation.title);
  const [body, setBody] = createSignal(props.annotation.body);
  const [draft, setDraft] = createSignal(props.annotation.body);
  const [saving, setSaving] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  // Two-step delete: the first click on the trash button only arms it
  // (icon swaps to a shredder as a "are you sure" cue); the actual
  // delete only fires on a second click while armed. Prevents an
  // accidental single click from destroying data.
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  // Tracks which field a double-click should focus once edit mode
  // mounts: the header (title) or the body textarea.
  const [focusField, setFocusField] = createSignal<"title" | "body">("body");

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
  const bringToFront = () => {
    setZIndex(props.nextZ());
    persistPosition();
  };

  // Persisted position/size for this device (see lib/positions.ts).
  // Size is intentionally not held in Solid state: it's written to the
  // DOM directly (imperative style) when a saved position loads, and
  // read directly from the DOM when saving. That keeps it out of the
  // way of the native CSS `resize` handle and of the textarea's
  // auto-grow-while-editing behavior below, neither of which go through
  // Solid's reactivity.
  let noteRef: HTMLDivElement | undefined;
  let titleInputRef: HTMLInputElement | undefined;
  let positionRecordId: string | undefined;

  const persistPosition = async () => {
    if (!noteRef) return;
    try {
      positionRecordId = await savePosition(
        props.annotation.id,
        { ...pos(), width: noteRef.offsetWidth, height: noteRef.offsetHeight, z: zIndex() },
        positionRecordId,
      );
    } catch (err) {
      console.error("[web-anno] failed to save position", err);
    }
  };

  // The native CSS `resize` handle -- and content growth while editing
  // (see resizeTextarea) -- change the note's box size without firing
  // any dedicated JS event. This just uses that as a trigger to persist
  // the current size, debounced so a drag doesn't spam writes; the
  // first observation (on mount/load) is skipped since it isn't a
  // resize.
  let skipNextResizeSave = true;
  let resizeSaveTimer: ReturnType<typeof setTimeout> | undefined;
  const resizeObserver = new ResizeObserver(() => {
    if (skipNextResizeSave) {
      skipNextResizeSave = false;
      return;
    }
    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(persistPosition, 300);
  });

  onMount(async () => {
    try {
      const saved = await fetchPosition(props.annotation.id);
      if (saved) {
        positionRecordId = saved.id;
        setPos({ top: saved.top, left: saved.left });
        setZIndex(saved.z);
        props.reportZ(saved.z);
      }
      // Mount the note now (see the `Show` below): this synchronously
      // inserts the DOM and fires the `ref` callback, so noteRef is only
      // safe to touch directly (width/height are imperative, unlike the
      // reactive `pos` signal set above) after this point.
      setPositionLoaded(true);
      if (saved && noteRef) {
        noteRef.style.width = `${saved.width}px`;
        noteRef.style.height = `${saved.height}px`;
      }
    } catch (err) {
      console.error("[web-anno] failed to load position", err);
      setPositionLoaded(true);
    }
  });

  onCleanup(() => {
    resizeObserver.disconnect();
    clearTimeout(resizeSaveTimer);
  });

  let dragStart: { x: number; y: number; top: number; left: number } | null = null;

  const startDrag = (e: PointerEvent) => {
    // Skip drag/capture when the pointerdown originated on a button
    // (Edit/Check) or the title input, so clicking into the title to
    // position the cursor doesn't start a drag. Once this element
    // captures the pointer, subsequent pointer events -- and the
    // mouseup/click events the browser derives from them -- are
    // redirected here too, so a captured header would silently swallow
    // clicks on its child controls.
    if ((e.target as HTMLElement).closest("button, input, textarea")) return;
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
    if (dragStart) persistPosition();
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

  const startEdit = (field: "title" | "body" = "body") => {
    setDraftTitle(title());
    setDraft(body());
    setFocusField(field);
    setEditing(true);
    setConfirmDelete(false);
    // Release any fixed height (from a saved/resized size) so the note
    // grows/shrinks to hug the textarea's content instead of scrolling
    // inside a stale box size. Width stays as-is -- only height should
    // track the text.
    if (noteRef) noteRef.style.height = "";
  };

  const cancelEdit = () => {
    setEditing(false);
    setConfirmDelete(false);
  };

  const saveEdit = async () => {
    setSaving(true);
    try {
      await updateAnnotation(props.annotation.id, { title: draftTitle(), body: draft() });
      setTitle(draftTitle());
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
  // First click arms confirmDelete (icon becomes a shredder); the
  // second click, while armed, performs the actual delete.
  const handleDelete = async () => {
    if (!confirmDelete()) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteAnnotation(props.annotation.id);
      setHidden(true);
    } catch (err) {
      console.error("[web-anno] failed to delete annotation", err);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Show when={!hidden() && positionLoaded()}>
      <div
        ref={(el) => {
          noteRef = el;
          resizeObserver.observe(el);
        }}
        onPointerDown={bringToFront}
        onFocusOut={(e) => {
          // Only save/exit once focus actually leaves the note (e.g.
          // clicking elsewhere on the page), not when it moves between
          // the title input and the body textarea within the same note.
          if (!editing()) return;
          const next = e.relatedTarget as Node | null;
          if (noteRef && next && noteRef.contains(next)) return;
          saveEdit();
        }}
        style={{
          position: "fixed",
          top: `${pos().top}px`,
          left: `${pos().left}px`,
          width: "260px",
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
          onDblClick={(e) => {
            // Same guard as the body's dblclick handler below: don't
            // start editing when the double-click landed on a button
            // (e.g. the Dismiss button).
            if ((e.target as HTMLElement).closest("button")) return;
            e.preventDefault();
            startEdit("title");
          }}
          style={{
            display: "flex",
            "align-items": "center",
            "justify-content": "space-between",
            gap: "8px",
            padding: "4px 8px",
            cursor: "grab",
            "border-bottom": `1px solid ${palette().headerBorder}`,
          }}
        >
          <Show
            when={!editing()}
            fallback={
              <TextField
                value={draftTitle()}
                onChange={setDraftTitle}
                disabled={saving()}
                // Same shrink-to-fit constraint as the reading-mode title
                // div below, so the wrapper (not just the inner input)
                // yields space to the Close button instead of pushing it
                // out of the header.
                style={{ flex: "1", "min-width": "0" }}
              >
                <TextField.Input
                  ref={(el) => {
                    titleInputRef = el;
                    // Only auto-focus the title input when the header
                    // (not the body) is what triggered edit mode.
                    if (focusField() === "title") {
                      queueMicrotask(() => el.focus());
                    }
                  }}
                  onKeyDown={onEditorKeyDown}
                  placeholder=""
                  style={{
                    width: "100%",
                    margin: "0",
                    padding: "0",
                    border: "none",
                    "box-sizing": "border-box",
                    font: "inherit",
                    "font-weight": "700",
                    background: "transparent",
                    color: palette().text,
                  }}
                />
              </TextField>
            }
          >
            <div
              style={{
                flex: "1",
                "min-width": "0",
                "font-weight": "700",
                overflow: "hidden",
                "text-overflow": "ellipsis",
                "white-space": "nowrap",
              }}
            >
              {title()}
            </div>
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
                    // second click before typing actually works. Only do
                    // this when the body (not the title) is the field
                    // that should receive focus.
                    if (focusField() === "body") {
                      queueMicrotask(() => el.focus());
                    }
                  }}
                  rows={1}
                  onInput={resizeTextarea}
                  onKeyDown={onEditorKeyDown}
                  style={{
                    display: "block",
                    width: "100%",
                    margin: "0",
                    padding: "0",
                    border: "none",
                    "box-sizing": "border-box",
                    resize: "none",
                    overflow: "hidden",
                    "white-space": "pre-wrap",
                    "overflow-wrap": "break-word",
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
              startEdit("body");
            }}
            style={{ padding: "10px 14px" }}
          >
            <AnnotationBody body={body()} />
          </div>
        </Show>

        {/* Footer only appears while editing, so a casual dismiss click
            can never delete data by accident. */}
        <Show when={editing()}>
          <div
            style={{
              display: "flex",
              "justify-content": "flex-start",
              padding: "4px 8px",
              "border-top": `1px solid ${palette().headerBorder}`,
            }}
          >
            <button
              type="button"
              // Prevent the textarea from losing focus on click: without
              // this, the pointerdown's default focus shift fires the
              // textarea's onFocusOut (saveEdit) first, which exits
              // editing mode and unmounts this button before its own
              // onClick can run -- so a click could never register.
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleDelete}
              disabled={deleting()}
              aria-label={confirmDelete() ? "Confirm delete" : "Delete"}
              style={iconButtonStyle}
            >
              <Show when={confirmDelete()} fallback={<Trash size={16} />}>
                <Shredder size={16} />
              </Show>
            </button>
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
  // Prevents this button from shrinking alongside the title
  // input/text in the header flex row, so it can never be squeezed
  // out of view.
  "flex-shrink": "0",
};

