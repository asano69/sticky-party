import { createResource, createSignal, onCleanup, Show } from "solid-js";

import {
  deleteAnnotation,
  setAnnotationColor,
  setAnnotationHide,
  updateAnnotation,
} from "../../lib/annotations";
import { fetchHistory } from "../../lib/history";
import { toggleTaskLine } from "../../lib/markup";
import { continueListOnEnter } from "../../lib/listContinuation";
import type { AnnotationData } from "../../lib/messages";
import {
  DEFAULT_NOTE_COLOR,
  isNoteColor,
  type NoteColor,
} from "../../lib/colors";
import { useContentHeight } from "./useContentHeight";
import { useParentMessaging } from "./useParentMessaging";
import NoteHeader from "./NoteHeader";
import NoteMain from "./NoteMain";
import NoteFooter from "./NoteFooter";

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
  // Tracks the in-flight PATCH from handleToggleHide, so the button
  // disables itself rather than allowing a second toggle mid-request.
  const [togglingHide, setTogglingHide] = createSignal(false);
  // Tracks the in-flight PATCH from handleColorChange, so the color
  // picker disables itself rather than allowing a second change
  // mid-request.
  const [togglingColor, setTogglingColor] = createSignal(false);
  // Client-side-only override that lets the viewer peek past the blur
  // without changing the persisted `hide` flag. Reset back to false
  // whenever hide is turned on again (see handleToggleHide), so the
  // note re-blurs the next time hide becomes true rather than staying
  // permanently revealed for the rest of the session.
  const [revealed, setRevealed] = createSignal(false);
  // Drives the shake animation on a single click of the lock button --
  // the actual reveal only happens on double-click (see the button
  // below), so a lone click gets this "not yet" wiggle instead of
  // silently doing nothing.
  const [shaking, setShaking] = createSignal(false);
  let shakeTimer: ReturnType<typeof setTimeout> | undefined;

  // Edit-history panel (see NoteMain.tsx), toggled by the footer's
  // info button. The resource only fetches while historyOpen() is
  // true, and re-fetches on every reopen, so the list stays current
  // without polling while closed.
  const [historyOpen, setHistoryOpen] = createSignal(false);
  const [history, { refetch: refetchHistory }] = createResource(
    () => (historyOpen() ? annotation()?.id : undefined),
    (id) => fetchHistory(id),
  );

  let titleInputRef: HTMLInputElement | undefined;

  // Textarea auto-resize + content-height reporting to content.ts; see
  // useContentHeight.ts (and docs/note-sizing.md for the full spec).
  const contentHeight = useContentHeight({ editing, draft, draftTitle });

  const startEdit = (field: "title" | "body" = "body") => {
    const current = annotation();
    if (!current) return;
    setDraftTitle(current.title);
    setDraft(current.body);
    setConfirmDelete(false);
    setEditing(true);
    queueMicrotask(() => {
      if (field === "title") titleInputRef?.focus();
      else contentHeight.focusTextarea();
    });
  };

  // Content height is intentionally NOT re-measured on exiting edit
  // mode: while editing, reportContentHeight (see useContentHeight.ts)
  // already keeps the note's size following the textarea (with its
  // 4-line floor), and that's the size we want to keep once saved --
  // re-measuring from the read-mode display here would shrink the note
  // back down below that floor.
  const parentMessaging = useParentMessaging({
    onInit: setAnnotation,
    onStartEditTitle: () => startEdit("title"),
    editing,
    onBlurWhileEditing: () => saveEdit(),
    onPinChange: (pin) => {
      const current = annotation();
      if (current) setAnnotation({ ...current, pin });
    },
  });

  const cancelEdit = () => {
    setEditing(false);
    setConfirmDelete(false);
  };

  // Restarts the shake animation on every single click of the lock
  // button, including the first click of a double-click -- setting
  // shaking back to false first (rather than leaving it true) forces
  // Solid to remove and re-add the class so the CSS animation replays
  // instead of being a no-op on rapid repeated clicks.
  const triggerShake = () => {
    clearTimeout(shakeTimer);
    setShaking(false);
    requestAnimationFrame(() => setShaking(true));
    shakeTimer = setTimeout(() => setShaking(false), 400);
  };
  onCleanup(() => clearTimeout(shakeTimer));

  const saveEdit = async () => {
    const current = annotation();
    if (!current) return;
    setSaving(true);
    try {
      await updateAnnotation(current.id, {
        title: draftTitle(),
        body: draft(),
      });
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
    } else if (e.key === "Enter" && e.target instanceof HTMLTextAreaElement) {
      // Only ever reached for the body textarea, never the title
      // <input> -- see lib/listContinuation.ts.
      const next = continueListOnEnter(e, e.target);
      if (next !== undefined) setDraft(next);
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
      parentMessaging.sendDeleted();
    } catch (err) {
      console.error("[sticky-party] failed to delete annotation", err);
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  // Toggles the annotation's `hide` flag (shoulder-surfing protection),
  // persisting it immediately -- unlike title/body, there's no separate
  // save step for this control.
  const handleToggleHide = async (next: boolean) => {
    const current = annotation();
    if (!current) return;
    setTogglingHide(true);
    try {
      await setAnnotationHide(current.id, next);
      setAnnotation({ ...current, hide: next });
      if (next) setRevealed(false);
    } catch (err) {
      console.error("[sticky-party] failed to toggle hide", err);
    } finally {
      setTogglingHide(false);
    }
  };

  // Sets the annotation's background color, persisting it immediately --
  // same pattern as handleToggleHide, since there's no separate save
  // step for footer controls.
  const handleColorChange = async (color: NoteColor) => {
    const current = annotation();
    if (!current) return;
    setTogglingColor(true);
    try {
      await setAnnotationColor(current.id, color);
      setAnnotation({ ...current, color });
    } catch (err) {
      console.error("[sticky-party] failed to change color", err);
    } finally {
      setTogglingColor(false);
    }
  };

  // Toggles a task line's checkbox directly from view mode (no edit
  // step needed), persisting the change immediately -- same pattern as
  // handleToggleHide/handleColorChange. Rewrites the raw body text via
  // toggleTaskLine rather than any parsed representation, so every
  // other line is left untouched.
  const handleToggleTask = async (lineIndex: number) => {
    const current = annotation();
    if (!current) return;
    const body = toggleTaskLine(current.body, lineIndex);
    try {
      await updateAnnotation(current.id, { title: current.title, body });
      setAnnotation({ ...current, body });
    } catch (err) {
      console.error("[sticky-party] failed to toggle task", err);
    }
  };

  return (
    // The loading state is now shown by content.ts (which owns the
    // wrapper on the host page), so this Show has no fallback -- while
    // annotation() is unset, this iframe simply renders nothing.
    <Show when={annotation()}>
      {(note) => (
        <div
          // Clicks inside this iframe don't bubble out to the wrapper's
          // own listeners (separate document), so report focus
          // explicitly to let the content script bring this note to
          // the front of the stack.
          onPointerDown={parentMessaging.sendFocus}
          // Overrides the shared --note-bg/--note-text (see
          // assets/theme.css) with this note's own color, falling back
          // to DEFAULT_NOTE_COLOR for empty/unrecognized values (e.g.
          // annotations created before the color field existed).
          style={{
            "--note-bg": `var(--note-color-${isNoteColor(note().color) ? note().color : DEFAULT_NOTE_COLOR}-bg)`,
            "--note-text": `var(--note-color-${isNoteColor(note().color) ? note().color : DEFAULT_NOTE_COLOR}-text)`,
          }}
          class="flex h-full flex-col box-border bg-[color:var(--note-bg)] text-[color:var(--note-text)] font-[system-ui,-apple-system,sans-serif] text-[14px] leading-[1.4]"
        >
          <NoteHeader
            title={note().title}
            editing={editing()}
            draftTitle={draftTitle()}
            onDraftTitleChange={setDraftTitle}
            saving={saving()}
            onKeyDown={onEditorKeyDown}
            titleInputRef={(el) => (titleInputRef = el)}
            pinned={note().pin}
            onTogglePin={parentMessaging.sendTogglePin}
          />

          <NoteMain
            note={note()}
            editing={editing()}
            draft={draft()}
            onDraftChange={setDraft}
            saving={saving()}
            onKeyDown={onEditorKeyDown}
            onStartEditBody={() => startEdit("body")}
            setContentRef={contentHeight.setContentRef}
            setTextareaRef={contentHeight.setTextareaRef}
            resizeTextarea={contentHeight.resizeTextarea}
            revealed={revealed()}
            shaking={shaking()}
            onLockClick={triggerShake}
            onLockDblClick={() => setRevealed(true)}
            onToggleTask={handleToggleTask}
            historyOpen={historyOpen()}
            historyEntries={history()}
          />

          {/* Footer only appears while editing, so a casual click can
              never delete data by accident. It's a normal flex item
              appended below main, not counted in main's own height:
              content.ts temporarily grows the note's wrapper by exactly
              TITLE_ROW_HEIGHT_PX while editing to make room for it, and
              reportContentHeight never includes it, so the note's
              saved/resting size is unaffected either way. */}
          <Show when={editing()}>
            <NoteFooter
              confirmDelete={confirmDelete()}
              deleting={deleting()}
              onDelete={handleDelete}
              hide={note().hide}
              togglingHide={togglingHide()}
              onToggleHide={handleToggleHide}
              color={
                isNoteColor(note().color) ? note().color : DEFAULT_NOTE_COLOR
              }
              togglingColor={togglingColor()}
              onColorChange={handleColorChange}
              historyOpen={historyOpen()}
              // Every open of the history panel explicitly refetches,
              // so the info button always shows up-to-date history --
              // not just the last-cached fetch from when the panel was
              // previously opened. No refetch on close: there's
              // nothing to refresh once the panel is hidden.
              onShowHistory={() => {
                const opening = !historyOpen();
                setHistoryOpen(opening);
                if (opening) refetchHistory();
              }}
            />
          </Show>
        </div>
      )}
    </Show>
  );
}
