// Renders a parsed annotation body: bullet lines get the CSS-drawn
// bullet defined in style.css (.sticky-party-bullet), task lines
// ("- [ ] ..." / "- [x] ...") get a checkbox instead, http(s) URLs
// become clickable links, and fenced code blocks (```lang ... ```)
// get syntax highlighting rendered server-side -- see
// lib/markup/codeblocks.ts and internal/render/render.go.

import { createResource, For, onCleanup, Show } from "solid-js";

import { parseLines } from "../../lib/markup";
import { splitBodySegments } from "../../lib/markup/codeblocks";
import { fetchRenders } from "../../lib/renders";
import { getSettings } from "../../lib/settings";
import { fetchAttachmentBlobUrl } from "../../lib/attachments";

// Renders a single "attachment" token (![[id]], see
// lib/markup/inline.ts) by fetching its image bytes with the viewer's
// own credentials and displaying it as a Blob URL -- never a plain
// <img src="pocketbase-file-url">, which wouldn't carry PocketBase's
// auth headers and would be rejected by the attachments collection's
// auth-gated viewRule. The Blob URL is revoked on cleanup so repeated
// mounts (e.g. toggling blur) don't leak memory.
//
// annotationId scopes the fetch to the annotation this token was
// rendered from: fetchAttachmentBlobUrl returns undefined (rendered as
// plain text below) if the attachment actually belongs to a different
// annotation -- e.g. someone copy-pasted a ![[id]] embed from one
// note's body into another's.
//
// blobUrl.state is checked instead of calling the blobUrl() accessor
// directly, since calling a createResource accessor while it's in its
// "errored" state re-throws that error into the render tree -- which
// would take down this whole note (including its edit/delete
// controls) rather than just this one broken image. Any failure --
// mismatched annotation, a deleted file, a network error -- is shown
// as plain fallback text instead, so a single unreadable image can
// never make the annotation impossible to edit or delete.
function AttachmentImage(props: {
  attachmentId: string;
  annotationId: string;
}) {
  const [blobUrl] = createResource(
    () => [props.attachmentId, props.annotationId] as const,
    ([attachmentId, annotationId]) =>
      fetchAttachmentBlobUrl(attachmentId, annotationId),
  );
  onCleanup(() => {
    if (blobUrl.state === "ready" && blobUrl.latest) {
      URL.revokeObjectURL(blobUrl.latest);
    }
  });

  return (
    <Show
      when={blobUrl.state === "ready" && blobUrl.latest}
      fallback={<span class="opacity-60">[image unavailable]</span>}
    >
      {(url) => (
        <img src={url()} loading="lazy" class="my-1 block max-w-full rounded" />
      )}
    </Show>
  );
}

// Renders a single fenced code block. Shows the server-rendered,
// syntax-highlighted HTML once available (see internal/render);
// falls back to plain, unhighlighted text before that -- e.g. right
// after saving a brand-new block, before the create/update hook has
// had a chance to run.
function CodeBlock(props: { source: string; html?: string }) {
  return (
    <Show
      when={props.html}
      fallback={
        <pre class="my-1 overflow-x-auto rounded bg-black/10 p-2 text-[0.85em]">
          <code>{props.source}</code>
        </pre>
      }
    >
      {(html) => (
        <div
          class="my-1 overflow-x-auto rounded bg-black/10 p-2 text-[0.85em] [&_pre]:m-0 [&_pre]:bg-transparent"
          // html comes from our own server-side chroma renderer
          // (internal/render), never from arbitrary user input, so
          // inserting it directly is safe.
          innerHTML={html()}
        />
      )}
    </Show>
  );
}

export default function AnnotationBody(props: {
  body: string;
  // The annotation this body belongs to -- passed through to
  // AttachmentImage so it can refuse to render an embed that was
  // pasted in from a different annotation's body.
  annotationId: string;
  // Called with a task line's index (matching parseLines's array
  // order within its own text segment, translated back to the full
  // body's line index via that segment's startLine -- see
  // lib/markup/codeblocks.ts) when its checkbox is toggled.
  onToggleTask?: (lineIndex: number) => void;
}) {
  // Needed to build the /embed proxy URL for iframe tokens below -- see
  // that block's comment for why the proxy exists at all.
  const [settings] = createResource(getSettings);
  // Cached syntax-highlighted HTML for this annotation's fenced code
  // blocks (see lib/renders.ts). Refetched whenever the annotation id
  // changes; a block not yet present in the map falls back to plain
  // text (see CodeBlock above) until the next fetch picks it up.
  const [renders] = createResource(() => props.annotationId, fetchRenders);

  return (
    <For each={splitBodySegments(props.body)}>
      {(segment) =>
        segment.type === "code" ? (
          <CodeBlock
            source={segment.source}
            html={renders()?.get(segment.hash)}
          />
        ) : (
          <For each={parseLines(segment.raw)}>
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
                    onChange={() =>
                      props.onToggleTask?.(segment.startLine + index())
                    }
                    // accent-current would follow text color too, but Tailwind
                    // has no "current" keyword for accent-color, so the note's
                    // own --note-text var is used directly (same pattern as
                    // NoteHeader.tsx/NoteMain.tsx's text color classes).
                    class="mt-[3px] shrink-0 cursor-pointer accent-[color:var(--note-text)]"
                  />
                </Show>
                <span
                  class={line.checked ? "line-through opacity-60" : undefined}
                >
                  <For each={line.tokens}>
                    {(token) =>
                      token.type === "attachment" ? (
                        <AttachmentImage
                          attachmentId={token.value}
                          annotationId={props.annotationId}
                        />
                      ) : token.type === "image" ? (
                        <img
                          src={token.value}
                          alt={token.alt || ""}
                          loading="lazy"
                          class="my-1 block max-w-full rounded"
                        />
                      ) : token.type === "iframe" ? (
                        <Show when={settings()?.backendUrl}>
                          {(backendUrl) => (
                            <div
                              class="my-1 w-full overflow-hidden rounded"
                              style={{
                                "aspect-ratio":
                                  token.width && token.height
                                    ? `${token.width} / ${token.height}`
                                    : "16 / 9",
                              }}
                            >
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
                          {token.label ?? token.value}
                        </a>
                      ) : token.type === "bold" ? (
                        <strong>{token.value}</strong>
                      ) : (
                        token.value
                      )
                    }
                  </For>
                </span>
              </div>
            )}
          </For>
        )
      }
    </For>
  );
}
