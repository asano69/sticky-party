// Persists the popup's chosen background color (set via the color
// picker in Home.tsx's footer, see lib/components/AppearanceControls.tsx),
// so the popup keeps showing the same theme color the next time it's
// opened instead of resetting to DEFAULT_NOTE_COLOR every time.

import { DEFAULT_NOTE_COLOR, isNoteColor, type NoteColor } from "./colors";

const POPUP_COLOR_KEY = "popupColor";

export async function getPopupColor(): Promise<NoteColor> {
  const result = await browser.storage.local.get(POPUP_COLOR_KEY);
  const stored = result[POPUP_COLOR_KEY] as string | undefined;
  return stored && isNoteColor(stored) ? stored : DEFAULT_NOTE_COLOR;
}

export async function savePopupColor(color: NoteColor): Promise<void> {
  await browser.storage.local.set({ [POPUP_COLOR_KEY]: color });
}

// Overrides the popup's --note-bg/--note-text CSS variables (normally
// fixed to the "yellow" pair in assets/theme.css) on the document root,
// so the whole popup -- not just the note being composed -- reflects
// the chosen color. An inline style on an element always wins over that
// same element's own stylesheet rules, so this overrides the plain
// `:root { --note-bg: ...; }` declaration in popup/style.css. The
// referenced --note-color-<name>-bg/-text pair still switches with
// light/dark mode on its own (see assets/theme.css), so this stays
// correct in both.
export function applyPopupColor(color: NoteColor): void {
  document.documentElement.style.setProperty(
    "--note-bg",
    `var(--note-color-${color}-bg)`,
  );
  document.documentElement.style.setProperty(
    "--note-text",
    `var(--note-color-${color}-text)`,
  );
}
