// Renders a parsed annotation body: bullet lines get the CSS-drawn
// bullet defined in style.css (.sticky-party-bullet), task lines
// ("- [ ] ..." / "- [x] ...") get a checkbox instead, and http(s) URLs
// become clickable links.

import { For, Show } from "solid-js";

import { parseLines } from "../../lib/markup";

export default function AnnotationBody(props: {
  body: string;
  // Called with a task line's index (matching parseLines's array
  // order, which is also the line index toggleTaskLine expects) when
  // its checkbox is toggled. Only fires for task lines -- see
  // lib/markup's TASK_PATTERN.
  onToggleTask?: (lineIndex: number) => void;
}) {
  return (
    <For each={parseLines(props.body)}>
      {(line, index) => (
        <div
          class={
            line.checked !== undefined
              ? "flex items-start gap-1.5"
              : line.bullet
                ? "sticky-party-bullet"
                : undefined
          }
          style={{
            "white-space": "pre-wrap",
            "overflow-wrap": "break-word",
            // Without an explicit min-height, a blank line collapses to
            // zero height: an empty <div> has no text node to
            // establish a line box, so a run of blank lines the user
            // typed to separate paragraphs visually disappears.
            "min-height": "1.4em",
          }}
        >
          <Show when={line.checked !== undefined}>
            <input
              type="checkbox"
              checked={line.checked}
              onChange={() => props.onToggleTask?.(index())}
              // accent-current would follow text color too, but Tailwind
              // has no "current" keyword for accent-color, so the note's
              // own --note-text var is used directly (same pattern as
              // NoteHeader.tsx/NoteMain.tsx's text color classes).
              class="mt-[3px] shrink-0 cursor-pointer accent-[color:var(--note-text)]"
            />
          </Show>
          <span class={line.checked ? "line-through opacity-60" : undefined}>
            <For each={line.tokens}>
              {(token) =>
                token.type === "image" ? (
                  <img
                    src={token.value}
                    alt={token.alt || ""}
                    loading="lazy"
                    class="my-1 block max-w-full rounded"
                  />
                ) : token.type === "link" ? (
                  <a
                    href={token.value}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {token.value}
                  </a>
                ) : (
                  token.value
                )
              }
            </For>
          </span>
        </div>
      )}
    </For>
  );
}
