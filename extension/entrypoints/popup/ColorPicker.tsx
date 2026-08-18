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
    // relative + the swatch list below being absolute: opening the
    // picker must overlay neighboring NavBar elements (title, sync
    // button) instead of shoving them aside.
    <div class="relative flex shrink-0 items-center">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Change note color"
        aria-pressed={open()}
        class="block h-4 w-4 shrink-0 rounded-full border border-[color:var(--note-button-border)]"
        style={{ "background-color": swatchColor(props.color) }}
      />
      <Show when={open()}>
        {/* left-4 starts right after the toggle button so it never
            covers it. bg-[--note-bg] makes this opaque, so it visually
            overwrites whatever sits to its right rather than pushing
            it further away. */}
        <div class="absolute left-4 top-1/2 z-10 flex -translate-y-1/2 items-center gap-1 rounded-r-full bg-[color:var(--note-bg)] py-1 pl-2 pr-1">
          {/* The currently selected color is already shown by the
              toggle button itself, so it's excluded here. */}
          <For each={NOTE_COLORS.filter((c) => c !== props.color)}>
            {(c) => (
              <button
                type="button"
                onClick={() => {
                  props.onColorChange(c);
                  setOpen(false);
                }}
                aria-label={c}
                class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                style={{ "background-color": swatchColor(c) }}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
