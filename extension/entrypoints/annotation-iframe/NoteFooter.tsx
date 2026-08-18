// Renders a note's edit-mode footer: delete (two-step confirm), color
// picker, and blur toggle. Only shown while editing (see the Show block
// in NoteContent.tsx), so a casual click can never delete data by
// accident, and its height (TITLE_ROW_HEIGHT_PX) is added back into
// the wrapper by content.ts only while editing -- see
// docs/note-sizing.md.

import { createSignal, For, Show } from "solid-js";
import Trash from "lucide-solid/icons/trash";
import Shredder from "lucide-solid/icons/shredder";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import Palette from "lucide-solid/icons/palette";
import { Button } from "@kobalte/core/button";
import { ToggleButton } from "@kobalte/core/toggle-button";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";
import { NOTE_COLORS, swatchColor, type NoteColor } from "../../lib/colors";

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
}) {
  // Whether the color swatches are shown. Local to this component (not
  // annotation.color's own state), since it's purely a UI reveal, not
  // something persisted.
  const [pickerOpen, setPickerOpen] = createSignal(false);

  return (
    <footer
      // Height stays inline for the same reason as the title row in
      // NoteHeader.tsx: it must stay tied to TITLE_ROW_HEIGHT_PX.
      style={{ height: `${TITLE_ROW_HEIGHT_PX}px` }}
      // overflow-hidden: if the note is too narrow to fit all five
      // swatches, they simply get clipped -- widening the note is the
      // fix, not wrapping or scrolling this row.
      class="flex shrink-0 items-center justify-start gap-1 box-border px-2 border-t border-[color:var(--note-border)] overflow-hidden"
    >
      <Button
        class="sticky-party-icon-btn flex items-center justify-center border-none bg-transparent cursor-pointer px-2 py-1.5 rounded"
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        onClick={props.onDelete}
        disabled={props.deleting}
        aria-label={props.confirmDelete ? "Confirm delete" : "Delete"}
      >
        <Show when={props.hide} fallback={<Trash size={16} />}>
          <Shredder  size={16} />
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
      {/* Same pointerdown/blur trap as the buttons above. */}
      <Button
        class="sticky-party-icon-btn flex items-center justify-center border-none bg-transparent cursor-pointer px-2 py-1.5 rounded"
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        onClick={() => setPickerOpen((open) => !open)}
        aria-label="Change color"
        aria-pressed={pickerOpen()}
      >
        <Palette size={16} />
      </Button>
      <Show when={pickerOpen()}>
        {/* onMouseDown preventDefault on the group covers every swatch
            button inside it (the event still bubbles up before its
            default action runs), same trap as the buttons above. */}
        <ToggleGroup
          value={props.color}
          onChange={(value) => value && props.onColorChange(value as NoteColor)}
          disabled={props.togglingColor}
          onMouseDown={(e: MouseEvent) => e.preventDefault()}
          class="flex shrink-0 items-center gap-1"
        >
          <For each={NOTE_COLORS}>
            {(color) => (
              <ToggleGroup.Item
                value={color}
                aria-label={color}
                class="flex items-center justify-center rounded-full p-0.5 data-[pressed]:ring-2 data-[pressed]:ring-[color:var(--note-text)]"
              >
                {/* @kobalte/core@0.13.13 (see pnpm-lock.yaml) has no
                    color-swatch export yet, so the swatch itself is
                    just a plain colored circle rather than Kobalte's
                    ColorSwatch component. */}
                <div
                  class="block h-4 w-4 rounded-full"
                  style={{ "background-color": swatchColor(color) }}
                />
              </ToggleGroup.Item>
            )}
          </For>
        </ToggleGroup>
      </Show>
    </footer>
  );
}
