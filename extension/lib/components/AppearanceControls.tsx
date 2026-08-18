// Shared color-picker + blur-toggle controls for a sticky note's
// appearance (hide/color). Used both while editing an existing note
// (NoteFooter.tsx, which persists each change immediately via PATCH)
// and while composing a new one in the popup (Home.tsx, which just
// holds local state and includes it in the create() payload instead).
// Delete stays out of this component since it only makes sense for an
// existing annotation.

import { createSignal, For, Show } from "solid-js";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import Palette from "lucide-solid/icons/palette";
import { Button } from "@kobalte/core/button";
import { ToggleButton } from "@kobalte/core/toggle-button";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { NOTE_COLORS, swatchColor, type NoteColor } from "../colors";

export default function AppearanceControls(props: {
  hide: boolean;
  onHideChange: (next: boolean) => void;
  hideDisabled?: boolean;
  color: NoteColor;
  onColorChange: (color: NoteColor) => void;
  colorDisabled?: boolean;
}) {
  // Whether the color swatches are shown. Local to this component, not
  // persisted state -- purely a UI reveal, same as NoteFooter's old
  // pickerOpen signal.
  const [pickerOpen, setPickerOpen] = createSignal(false);

  return (
    <>
      {/* onMouseDown preventDefault: while editing inside the
          annotation-iframe, a pointerdown-before-click here would fire
          the window "blur" handler's saveEdit() first (see
          NoteContent.tsx's useParentMessaging) -- harmless in the
          popup, but kept here since this component is shared. */}
      <ToggleButton
        class="sticky-party-icon-btn flex items-center justify-center border-none bg-transparent cursor-pointer px-2 py-1.5 rounded"
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        pressed={props.hide}
        onChange={props.onHideChange}
        disabled={props.hideDisabled}
        aria-label={props.hide ? "Unblur note" : "Blur note"}
      >
        <Show when={props.hide} fallback={<Eye size={16} />}>
          <EyeOff size={16} />
        </Show>
      </ToggleButton>
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
        <ToggleGroup
          value={props.color}
          onChange={(value) => value && props.onColorChange(value as NoteColor)}
          disabled={props.colorDisabled}
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
                {/* @kobalte/core@0.13.13 has no color-swatch export
                    yet, so the swatch itself is just a plain colored
                    circle rather than Kobalte's ColorSwatch component. */}
                <div
                  class="block h-4 w-4 rounded-full"
                  style={{ "background-color": swatchColor(color) }}
                />
              </ToggleGroup.Item>
            )}
          </For>
        </ToggleGroup>
      </Show>
    </>
  );
}
