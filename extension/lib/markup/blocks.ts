// Splits annotation body text into lines, detecting bullet markers
// ("* " or "- " at the start of a line) and delegating the rest of each
// line to inline.ts. New block-level rules (e.g. headings) belong here.

import { parseInline } from "./inline";
import type { Line } from "./types";

// A bullet marker is "*" or "-" followed by at least one whitespace
// character; the whitespace is required so "*bold*" or "-5" isn't
// mistaken for a bullet.
const BULLET_PATTERN = /^[*-]\s+(.*)$/;

// A task marker is "[ ]" or "[x]"/"[X]" (checked) right after the
// bullet marker, followed by at least one whitespace character before
// the task's own text -- e.g. "- [ ] buy milk" or "- [x] buy milk".
const TASK_PATTERN = /^\[([ xX])\]\s+(.*)$/;

export function parseLines(body: string): Line[] {
  return body.split("\n").map((raw) => {
    const bulletMatch = raw.match(BULLET_PATTERN);
    if (bulletMatch) {
      const taskMatch = bulletMatch[1].match(TASK_PATTERN);
      if (taskMatch) {
        return {
          bullet: false,
          checked: taskMatch[1].toLowerCase() === "x",
          tokens: parseInline(taskMatch[2]),
        };
      }
      return { bullet: true, tokens: parseInline(bulletMatch[1]) };
    }
    return { bullet: false, tokens: parseInline(raw) };
  });
}

// Flips a task line's checked state directly in the raw body text, at
// `lineIndex` (matching the array index parseLines would give that
// line). Used by the view-mode checkbox toggle (see AnnotationBody.tsx)
// to persist a change without re-serializing the whole parsed structure
// -- every other line is left byte-for-byte untouched. The regex here
// intentionally mirrors BULLET_PATTERN + TASK_PATTERN above; if the
// task syntax ever changes, update both.
export function toggleTaskLine(body: string, lineIndex: number): string {
  const lines = body.split("\n");
  const line = lines[lineIndex];
  if (line === undefined) return body;
  lines[lineIndex] = line.replace(
    /^([*-]\s+\[)([ xX])(\]\s+)/,
    (_match, prefix, mark, suffix) =>
      `${prefix}${mark.toLowerCase() === "x" ? " " : "x"}${suffix}`,
  );
  return lines.join("\n");
}

// Marker match for list continuation: captures the bullet marker plus
// its trailing whitespace (group 1) and the rest of the line (group 2).
// Mirrors BULLET_PATTERN above -- keep both in sync if the bullet
// syntax ever changes.
const LIST_MARKER_PATTERN = /^([*-]\s+)(.*)$/;

// Returns the marker text that continues `line`'s list item onto a new
// line -- "- " for a plain bullet, "- [ ] " for a task (always
// unchecked, even when continuing off a checked task) -- or undefined
// if `line` isn't a bullet/task line at all. Used by NoteContent.tsx's
// Enter-key handler to auto-continue list syntax while editing.
export function listContinuationPrefix(line: string): string | undefined {
  const markerMatch = line.match(LIST_MARKER_PATTERN);
  if (!markerMatch) return undefined;
  const [, marker, rest] = markerMatch;
  return TASK_PATTERN.test(rest) ? `${marker}[ ] ` : marker;
}
