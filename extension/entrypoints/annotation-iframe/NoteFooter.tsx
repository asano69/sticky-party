// Renders a note's edit-mode footer: delete (two-step confirm) and
// blur toggle. Only shown while editing (see the Show block in
// NoteContent.tsx), so a casual click can never delete data by
// accident, and its height (TITLE_ROW_HEIGHT_PX) is added back into
// the wrapper by content.ts only while editing -- see
// docs/note-sizing.md.

import { Show } from "solid-js";
import Trash from "lucide-solid/icons/trash";
import Shredder from "lucide-solid/icons/shredder";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import { Button } from "@kobalte/core/button";
import { ToggleButton } from "@kobalte/core/toggle-button";
import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";

export default function NoteFooter(props: {
  confirmDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  hide: boolean;
  togglingHide: boolean;
  onToggleHide: (next: boolean) => void;
}) {
  return (
    <footer
      // Height stays inline for the same reason as the title row in
      // NoteHeader.tsx: it must stay tied to TITLE_ROW_HEIGHT_PX.
      style={{ height: `${TITLE_ROW_HEIGHT_PX}px` }}
      class="flex shrink-0 items-center justify-start gap-1 box-border px-2 border-t border-[color:var(--note-border)]"
    >
      <Button
        class="sticky-party-icon-btn flex items-center justify-center border-none bg-transparent cursor-pointer px-2 py-1.5 rounded"
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        onClick={props.onDelete}
        disabled={props.deleting}
        aria-label={props.confirmDelete ? "Confirm delete" : "Delete"}
      >
        <Show when={props.confirmDelete} fallback={<Trash size={16} />}>
          <Shredder size={16} />
        </Show>
      </Button>
      {/* onMouseDown preventDefault mirrors the delete button above:
          without it, the pointerdown-before-click on this button
          would fire the iframe's window "blur" handler's saveEdit()
          first, same trap noted for the delete flow. */}
      <ToggleButton
        class="sticky-party-icon-btn flex items-center justify-center border-none bg-transparent cursor-pointer px-2 py-1.5 rounded"
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        pressed={props.hide}
        onChange={props.onToggleHide}
        disabled={props.togglingHide}
        aria-label={props.hide ? "Unblur note" : "Blur note"}
      >
        <Show when={props.hide} fallback={<Eye size={16} />}>
          <EyeOff size={16} />
        </Show>
      </ToggleButton>
    </footer>
  );
}
