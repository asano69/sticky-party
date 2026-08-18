// Shared Enter-key handler for auto-continuing bullet/task list syntax
// in a plain <textarea>: if the line the cursor is on starts with a
// bullet or task marker, the new line gets the same marker prepended
// ("- " or "- [ ] ", always unchecked even when continuing off a
// checked task -- see lib/markup's listContinuationPrefix). Used by
// both the annotation-iframe's edit textarea (NoteContent.tsx) and the
// popup's new-note textarea (Home.tsx), so list continuation behaves
// identically wherever a note body can be typed.
//
// Mutates `textarea`'s value/caret directly and returns the new value,
// or undefined if the current line has no list marker to continue (in
// which case Enter is left to behave normally). Callers still own their
// own value signal and must pass the returned string to it themselves --
// this only touches the DOM element, not Solid state.

import { listContinuationPrefix } from "./markup";

export function continueListOnEnter(
  e: KeyboardEvent,
  textarea: HTMLTextAreaElement,
): string | undefined {
  const { value, selectionStart, selectionEnd } = textarea;
  const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const currentLine = value.slice(lineStart, selectionStart);
  const prefix = listContinuationPrefix(currentLine);
  if (!prefix) return undefined;

  e.preventDefault();
  const insertion = `\n${prefix}`;
  const next =
    value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
  const cursor = selectionStart + insertion.length;

  // No input event fires for a prevented Enter, so the textarea's own
  // value/caret must be updated by hand, not just the caller's signal --
  // Solid leaves an already-matching value's caret untouched.
  textarea.value = next;
  textarea.selectionStart = textarea.selectionEnd = cursor;
  return next;
}
