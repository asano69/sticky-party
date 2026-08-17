// Renders a note's body: read-only markup, or an editable textarea
// while editing, plus the blur/lock overlay used to guard sensitive
// notes from shoulder-surfing (see NOTE_CONTENT_RESIZE_MESSAGE and
// docs/note-sizing.md for how this area's height is measured -- that
// logic lives in useContentHeight.ts, not here).

import { Show } from "solid-js";
import Lock from "lucide-solid/icons/lock";
import { TextField } from "@kobalte/core/text-field";
import { Button } from "@kobalte/core/button";
import type { AnnotationData } from "../../lib/messages";
import AnnotationBody from "./AnnotationBody";

export default function NoteMain(props: {
  note: AnnotationData;
  editing: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  saving: boolean;
  onKeyDown: (e: KeyboardEvent) => void;
  onStartEditBody: () => void;
  setContentRef: (el: HTMLDivElement) => void;
  setTextareaRef: (el: HTMLTextAreaElement) => void;
  resizeTextarea: () => void;
  revealed: boolean;
  shaking: boolean;
  onLockClick: () => void;
  onLockDblClick: () => void;
  onToggleTask: (lineIndex: number) => void;
}) {
  return (
    // position:relative so the lock-overlay button below can be
    // absolutely positioned over this area. Blur itself is applied to
    // the inner wrapper div, not this element -- blurring this element
    // directly would blur the overlay button too, since a CSS filter
    // blurs an element's own rendered content (including children) as
    // a whole.
    <main
      ref={props.setContentRef}
      onDblClick={(e) => {
        // Only view mode should enter editing here; while already
        // editing, calling onStartEditBody would reset the draft back
        // to the saved value, discarding any unsaved changes.
        if (props.editing) return;
        e.preventDefault();
        props.onStartEditBody();
      }}
      class="relative flex-1 overflow-auto px-2.5 py-1.5"
    >
      {/* Fully hides the text (not just blurs it) when hidden, so no
          content leaks through -- only the lock overlay below stays
          visible. */}
      <div classList={{ invisible: props.note.hide && !props.revealed }}>
        <Show
          when={!props.editing}
          fallback={
            <TextField
              value={props.draft}
              onChange={props.onDraftChange}
              disabled={props.saving}
            >
              <TextField.TextArea
                ref={props.setTextareaRef}
                // Floor: with no CSS height set, a textarea's
                // intrinsic height comes from `rows`, and
                // scrollHeight (used by resizeTextarea) can't go
                // below that -- so this keeps the note at least
                // 1 line tall, growing (and shrinking back) with
                // its content beyond that.
                rows={1}
                onInput={props.resizeTextarea}
                onKeyDown={props.onKeyDown}
                // No min-h-full here: that would pin the textarea to
                // the note's current (possibly larger, e.g. from a
                // previous longer draft) height, preventing it from
                // ever shrinking back down when content is removed.
                class="block w-full box-border border-none resize-none overflow-hidden bg-transparent font-[inherit] text-[color:var(--note-text)]"
              />
            </TextField>
          }
        >
          {/* min-h-full makes this fill the whole main area (not
              just wrap the text), so double-clicking any blank space
              below a short body still starts editing. */}
          <div class="min-h-full">
            <AnnotationBody
              body={props.note.body}
              onToggleTask={props.onToggleTask}
            />
          </div>
        </Show>
      </div>

      {/* Lets the viewer peek past the blur without changing the
          persisted hide flag -- a per-view override, not a toggle of
          hide itself (that's the footer's eye button). */}
      <Show when={props.note.hide && !props.revealed}>
        <div class="absolute inset-0 flex items-center justify-center">
          <Button
            onClick={props.onLockClick}
            onDblClick={props.onLockDblClick}
            aria-label="Double-click to reveal note"
            class={`sticky-party-icon-btn flex items-center justify-center border-none cursor-pointer p-2 rounded-full${
              props.shaking ? " sticky-party-shake" : ""
            }`}
          >
            <Lock size={20} />
          </Button>
        </div>
      </Show>
    </main>
  );
}
