// Renders a note's title row: read-only text, or an editable input
// while editing. Sits directly under the content script's transparent
// drag header (see content.ts), which is exactly TITLE_ROW_HEIGHT_PX
// tall and overlays the Dismiss button -- that's why the title text
// stops short of the row's right edge (padding-right below).

import { Show } from "solid-js";
import Pin from "lucide-solid/icons/pin";
import PinOff from "lucide-solid/icons/pin-off";
import { TextField } from "@kobalte/core/text-field";
import { ToggleButton } from "@kobalte/core/toggle-button";
import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";

export default function NoteHeader(props: {
  title: string;
  editing: boolean;
  draftTitle: string;
  onDraftTitleChange: (value: string) => void;
  saving: boolean;
  onKeyDown: (e: KeyboardEvent) => void;
  titleInputRef: (el: HTMLInputElement) => void;
  // Whether this note is pinned to a fixed spot on the page. The toggle
  // button below only renders while editing -- not because pin itself
  // is edit-only, but because that's exactly the window during which
  // content.ts's drag-header overlay sets pointer-events:none (see its
  // NOTE_EDITING_MESSAGE handler), handing off clicks to this iframe.
  // Outside that window the overlay still owns this row (drag,
  // double-click-to-edit), so a pin button here would either be
  // unreachable or fight the overlay for clicks.
  pinned: boolean;
  onTogglePin: () => void;
}) {
  return (
    <header
      // Height stays inline (not a Tailwind class) since it must
      // stay tied to the TITLE_ROW_HEIGHT_PX constant -- a
      // hardcoded class here would be a second source of truth
      // that could drift from content.ts's drag-header overlay,
      // which this row has to line up with pixel-for-pixel.
      style={{ height: `${TITLE_ROW_HEIGHT_PX}px` }}
      // pr-10 reserves space for content.ts's Dismiss button, drawn on
      // top of this row from the host page's document (see content.ts).
      // Pin no longer lives there -- it's a footer button now (see
      // NoteFooter.tsx) -- so no left padding needs to be reserved.
      class="flex shrink-0 items-center box-border pl-2 pr-10 font-bold border-b border-[color:var(--note-border)]"
    >
      <Show
        when={!props.editing}
        fallback={
          <>
            <TextField
              value={props.draftTitle}
              onChange={props.onDraftTitleChange}
              disabled={props.saving}
              class="flex-1 min-w-0"
            >
              <TextField.Input
                ref={props.titleInputRef}
                onKeyDown={props.onKeyDown}
                class="w-full box-border border-none bg-transparent font-[inherit] font-bold text-[color:var(--note-text)]"
              />
            </TextField>
            {/* onMouseDown preventDefault mirrors NoteFooter.tsx's
                buttons: without it, the pointerdown-before-click on
                this button would fire the window "blur" handler's
                saveEdit() first (see useParentMessaging.ts). */}
            <ToggleButton
              class="sticky-party-icon-btn flex shrink-0 items-center justify-center border-none bg-transparent cursor-pointer p-1 rounded"
              onMouseDown={(e: MouseEvent) => e.preventDefault()}
              pressed={props.pinned}
              onChange={() => props.onTogglePin()}
              aria-label={props.pinned ? "Unpin from page" : "Pin to page"}
            >
              <Show when={props.pinned} fallback={<PinOff size={16} />}>
                <Pin size={16} />
              </Show>
            </ToggleButton>
          </>
        }
      >
        <div class="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {props.title}
        </div>
      </Show>
    </header>
  );
}
