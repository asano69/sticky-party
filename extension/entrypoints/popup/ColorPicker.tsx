// Color picker for the popup's NavBar (used to set both the new-note's
// color and the popup's overall background theme -- see App.tsx).
// Deliberately not shared with the annotation-iframe's footer color
// control (NoteFooter.tsx / lib/components/AppearanceControls.tsx):
// the two live in separate documents with different persistence needs
// (see lib/popupColor.ts vs lib/annotations.ts's setAnnotationColor),
// so sharing UI here only coupled them for no benefit.
//
// The button itself shows the currently selected color -- no separate
// icon -- and clicking it expands the other choices inline to its
// right, matching AppearanceControls' expand-in-place style (rather
// than a floating overlay).

import { createSignal, For, Show } from "solid-js";
import { NOTE_COLORS, swatchColor, type NoteColor } from "../../lib/colors";

export default function ColorPicker(props: {
  color: NoteColor;
  onColorChange: (color: NoteColor) => void;
}) {
  const [open, setOpen] = createSignal(false);

  return (
    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change note color"
        aria-pressed={open()}
        class="block h-4 w-4 shrink-0 rounded-full border border-[color:var(--note-button-border)]"
        style={{ "background-color": swatchColor(props.color) }}
      />
      <Show when={open()}>
        <For each={NOTE_COLORS}>
          {(c) => (
            <button
              type="button"
              onClick={() => {
                props.onColorChange(c);
                setOpen(false);
              }}
              aria-label={c}
              classList={{
                "ring-2 ring-[color:var(--note-text)]": c === props.color,
              }}
              class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
              style={{ "background-color": swatchColor(c) }}
            />
          )}
        </For>
      </Show>
    </div>
  );
}
