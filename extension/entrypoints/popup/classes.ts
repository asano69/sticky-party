// Shared Tailwind class strings for popup components. Centralized here
// so spacing/sizing stays consistent without duplicating long utility
// lists across every form and button (Home.tsx, Settings.tsx, Targets.tsx).

export const CARD = "flex flex-col gap-2 p-3 text-left";

export const FIELD = "flex flex-col gap-0.5";
export const FIELD_LABEL = "text-xs text-[color:var(--note-label)]";
export const FIELD_INPUT =
  "rounded-md border border-[color:var(--note-button-border)] bg-transparent px-2 py-1 text-[0.9em] text-inherit";
export const FIELD_TEXTAREA = `${FIELD_INPUT} resize-y font-[inherit]`;

export const ICON_BTN =
  "inline-flex items-center justify-center rounded-md p-1 text-inherit hover:bg-black/10";

export const SAVED_HINT = "m-0 text-[0.8em] text-[color:var(--note-label)]";
