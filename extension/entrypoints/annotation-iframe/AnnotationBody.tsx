// Renders a parsed annotation body: bullet lines get the CSS-drawn
// bullet defined in style.css (.sticky-party-bullet), and http(s) URLs
// become clickable links.

import { For } from "solid-js";

import { parseLines } from "../../lib/markup";

export default function AnnotationBody(props: { body: string }) {
  return (
    <For each={parseLines(props.body)}>
      {(line) => (
        <div
          class={line.bullet ? "sticky-party-bullet" : undefined}
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
