// Renders a note's edit-mode footer: delete (two-step confirm), plus
// the shared blur/color appearance controls (see
// lib/components/AppearanceControls.tsx, also used by the popup's
// Home.tsx when composing a new note). Only shown while editing (see
// the Show block in NoteContent.tsx), so a casual click can never
// delete data by accident, and its height (TITLE_ROW_HEIGHT_PX) is
// added back into the wrapper by content.ts only while editing -- see
// docs/note-sizing.md.

import { Show } from "solid-js";
import Trash from "lucide-solid/icons/trash";
import Shredder from "lucide-solid/icons/shredder";
import Info from "lucide-solid/icons/info";
import { Button } from "@kobalte/core/button";
import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";
import type { NoteColor } from "../../lib/colors";
import AppearanceControls from "../../lib/components/AppearanceControls";

export default function NoteFooter(props: {
  confirmDelete: boolean;
  deleting: boolean;
  onDelete: () => void;
  hide: boolean;
  togglingHide: boolean;
  onToggleHide: (next: boolean) => void;
  color: NoteColor;
  togglingColor: boolean;
  onColorChange: (color: NoteColor) => void;
  onShowHistory: () => void;
}) {
  return (
    <footer
      // Height stays inline for the same reason as the title row in
      // NoteHeader.tsx: it must stay tied to TITLE_ROW_HEIGHT_PX.
      style={{ height: `${TITLE_ROW_HEIGHT_PX}px` }}
      // overflow-hidden: if the note is too narrow to fit all five
      // swatches, they simply get clipped -- widening the note is the
      // fix, not wrapping or scrolling this row.
      class="flex shrink-0 items-center justify-start box-border px-2 border-t border-[color:var(--note-border)] overflow-hidden"
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
      <AppearanceControls
        hide={props.hide}
        onHideChange={props.onToggleHide}
        hideDisabled={props.togglingHide}
        color={props.color}
        onColorChange={props.onColorChange}
        colorDisabled={props.togglingColor}
      />
      {/* marginLeft: auto pins this to the footer's right edge, away
          from the delete/appearance controls on the left. */}
      <Button
        class="sticky-party-icon-btn ml-auto flex items-center justify-center border-none bg-transparent cursor-pointer px-2 py-1.5 rounded"
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        onClick={props.onShowHistory}
        aria-label="Show edit history"
      >
        <Info size={16} />
      </Button>
    </footer>
  );
}
