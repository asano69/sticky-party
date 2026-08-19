// Renders a parsed annotation body: bullet lines get the CSS-drawn
// bullet defined in style.css (.sticky-party-bullet), task lines
// ("- [ ] ..." / "- [x] ...") get a checkbox instead, and http(s) URLs
// become clickable links.

import { createResource, For, Show } from "solid-js";

import { parseLines } from "../../lib/markup";
import { getSettings } from "../../lib/settings";

export default function AnnotationBody(props: {
  body: string;
  // Called with a task line's index (matching parseLines's array
  // order, which is also the line index toggleTaskLine expects) when
  // its checkbox is toggled. Only fires for task lines -- see
  // lib/markup's TASK_PATTERN.
  onToggleTask?: (lineIndex: number) => void;
}) {
  // Needed to build the /embed proxy URL for iframe tokens below -- see
  // that block's comment for why the proxy exists at all.
  const [settings] = createResource(getSettings);

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
                ) : token.type === "iframe" ? (
                  // Nested iframe: this component already renders inside
                  // the note's own extension-origin iframe (see the
                  // file-level comment in entrypoints/content.ts). The
                  // target isn't loaded directly, though -- some embed
                  // providers (YouTube in particular) refuse to serve
                  // into a chrome-extension:// parent regardless of the
                  // video's own embed settings. Routing through the
                  // backend's /embed proxy (internal/serve/handler.go)
                  // gives the target iframe a normal https origin as its
                  // direct parent instead, which those providers accept.
                  <Show when={settings()?.backendUrl}>
                    {(backendUrl) => (
                      <div class="my-1 aspect-video w-full overflow-hidden rounded">
                        <iframe
                          src={`${backendUrl()}/embed?src=${encodeURIComponent(token.value)}`}
                          title="Embedded content"
                          loading="lazy"
                          class="h-full w-full"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowfullscreen
                          sandbox="allow-scripts allow-same-origin allow-presentation"
                        />
                      </div>
                    )}
                  </Show>
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
