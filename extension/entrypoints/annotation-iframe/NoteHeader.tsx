// Renders a note's title row: read-only text, or an editable input
// while editing. Sits directly under the content script's transparent
// drag header (see content.ts), which is exactly TITLE_ROW_HEIGHT_PX
// tall and overlays the Dismiss button -- that's why the title text
// stops short of the row's right edge (padding-right below).

import { Show } from "solid-js";
import { TextField } from "@kobalte/core/text-field";
import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";

export default function NoteHeader(props: {
  title: string;
  editing: boolean;
  draftTitle: string;
  onDraftTitleChange: (value: string) => void;
  saving: boolean;
  onKeyDown: (e: KeyboardEvent) => void;
  titleInputRef: (el: HTMLInputElement) => void;
}) {
  return (
    <header
      // Height stays inline (not a Tailwind class) since it must
      // stay tied to the TITLE_ROW_HEIGHT_PX constant -- a
      // hardcoded class here would be a second source of truth
      // that could drift from content.ts's drag-header overlay,
      // which this row has to line up with pixel-for-pixel.
      style={{ height: `${TITLE_ROW_HEIGHT_PX}px` }}
      class="flex shrink-0 items-center box-border pl-10 pr-10 font-bold border-b border-[color:var(--note-border)]"
    >
      <Show
        when={!props.editing}
        fallback={
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
        }
      >
        <div class="w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          {props.title}
        </div>
      </Show>
    </header>
  );
}
