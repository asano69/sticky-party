// Renders a parsed annotation body: bullet lines get the CSS-drawn
// bullet defined in content.ts (.web-anno-bullet), and http(s) URLs
// become clickable links. Kept separate from AnnotationBoard.tsx since
// it's only used in read (non-editing) mode.

import { For } from "solid-js";

import { parseLines } from "../../lib/markup";

export default function AnnotationBody(props: { body: string }) {
  return (
    <For each={parseLines(props.body)}>
      {(line) => (
        <div
          class={line.bullet ? "web-anno-bullet" : undefined}
          style={{ "white-space": "pre-wrap", "overflow-wrap": "break-word" }}
        >
          <For each={line.tokens}>
            {(token) =>
              token.type === "link" ? (
                <a href={token.value} target="_blank" rel="noopener noreferrer">
                  {token.value}
                </a>
              ) : (
                token.value
              )
            }
          </For>
        </div>
      )}
    </For>
  );
}
