// Sticky-note color palette. Each name is stored as plain text in the
// annotation's `color` field, and maps to a --note-color-<name>-bg/-text
// CSS variable pair defined (light + dark) in assets/theme.css -- see
// that file for the actual color values.

export const NOTE_COLORS = ["yellow", "pink", "green", "blue", "purple"] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export const DEFAULT_NOTE_COLOR: NoteColor = "yellow";

export function isNoteColor(value: string): value is NoteColor {
  return (NOTE_COLORS as readonly string[]).includes(value);
}

// A saturated, mid-lightness color for each option's picker swatch --
// independent of the note's actual (much lighter/darker) background, so
// the five options stay visually distinct in both light and dark mode.
const SWATCH_COLORS: Record<NoteColor, string> = {
  yellow: "hsl(50, 70%, 55%)",
  pink: "hsl(330, 70%, 55%)",
  green: "hsl(140, 55%, 45%)",
  blue: "hsl(210, 70%, 55%)",
  purple: "hsl(275, 55%, 55%)",
};

export function swatchColor(color: NoteColor): string {
  return SWATCH_COLORS[color];
}
