// Splits a single line of text into plain-text, link, and image tokens.
// Kept separate from blocks.ts so new inline rules (e.g. bold, mentions)
// can be added here without touching block-level parsing.

import type { InlineToken } from "./types";

function isAllowedIframeSrc(src: string): boolean {
  try {
    // Restricted to https since the backend's /embed proxy (see
    // internal/serve/handler.go) requires it too.
    return new URL(src).protocol === "https:";
  } catch {
    return false;
  }
}

// Reads the width/height off a matched <iframe> tag (e.g.
// `<iframe width="600" height="450" ...>`), so AnnotationBody.tsx can
// render the embed at its original aspect ratio instead of a fixed
// one. Most embed providers (YouTube, Google Maps, etc.) already
// include these on the tag people paste in, so no per-provider special
// casing is needed here.
//
// Uses DOMParser instead of a hand-rolled regex: attribute order,
// quote style (single/double), and extra whitespace all vary between
// what different sites hand out for "copy embed code", and a real HTML
// parser handles all of that for free instead of chasing edge cases in
// a regex.
function extractIframeDimensions(tag: string): {
  width?: number;
  height?: number;
} {
  const iframe = new DOMParser()
    .parseFromString(tag, "text/html")
    .querySelector("iframe");
  const width = iframe?.getAttribute("width");
  const height = iframe?.getAttribute("height");
  return {
    width: width ? Number(width) : undefined,
    height: height ? Number(height) : undefined,
  };
}

// Matches bold syntax (**text**), markdown image syntax (![alt](url)),
// markdown link syntax ([label](url)), a pasted YouTube <iframe> embed
// tag, or a bare http(s) URL up to the next whitespace character --
// whichever comes first. Combined into a single pattern -- rather than
// running separate passes -- so each match's own URL/src is consumed as
// part of that match and never also matched by the bare-URL alternative
// afterward. The URL inside the image/link parens stops at the first
// ")" or whitespace (not greedy to the next whitespace like the
// bare-URL case), so a normal closing paren isn't swallowed into the
// URL itself. The image alternative is listed before the plain-link
// alternative so `![alt](url)` is consumed whole rather than the link
// alternative matching the `[alt](url)` part on its own -- but since
// the image alternative requires a leading "!" and the link
// alternative doesn't, the two never actually compete for the same
// starting position. Only single-line <iframe>...</iframe> tags are
// matched, since blocks.ts splits the body into lines before this runs
// on each one.
const TOKEN_PATTERN =
  /\*\*([^*]+)\*\*|!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|<iframe\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>[\s\S]*?<\/iframe>|(https?:\/\/\S+)/gi;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    if (match[1] !== undefined) {
      // Bold syntax: **text**. Deliberately flat (no nested markup
      // inside bold), matching this parser's simplicity-first approach.
      tokens.push({ type: "bold", value: match[1] });
    } else if (match[3] !== undefined) {
      // Image syntax: ![alt](url) -- match[2] is the alt text, match[3]
      // is the URL.
      tokens.push({ type: "image", value: match[3], alt: match[2] });
    } else if (match[5] !== undefined) {
      // Markdown link syntax: [label](url) -- match[4] is the display
      // text, match[5] is the URL.
      tokens.push({ type: "link", value: match[5], label: match[4] });
    } else if (match[6] !== undefined) {
      // <iframe src="..."> embed -- match[6] is the src. Falls back to
      // rendering the raw tag text if the host isn't on the allowlist,
      // rather than silently dropping it or embedding an untrusted origin.
      if (isAllowedIframeSrc(match[6])) {
        tokens.push({
          type: "iframe",
          value: match[6],
          ...extractIframeDimensions(match[0]),
        });
      } else {
        tokens.push({ type: "text", value: match[0] });
      }
    } else {
      // Bare http(s) URL, no markdown syntax around it.
      tokens.push({ type: "link", value: match[7] });
    }
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }

  // An empty line still needs a token so it renders as a blank line
  // instead of collapsing to nothing.
  if (tokens.length === 0) {
    tokens.push({ type: "text", value: text });
  }

  return tokens;
}
