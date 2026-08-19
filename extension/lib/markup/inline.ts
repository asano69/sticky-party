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

// Matches markdown image syntax (![alt](url)), a pasted YouTube <iframe>
// embed tag, or a bare http(s) URL up to the next whitespace character --
// whichever comes first. Combined into a single pattern -- rather than
// running separate passes -- so each match's own URL/src is consumed as
// part of that match and never also matched by the bare-URL alternative
// afterward. The URL inside the image parens stops at the first ")" or
// whitespace (not greedy to the next whitespace like the bare-URL case),
// so a normal closing paren isn't swallowed into the URL itself. Only
// single-line <iframe>...</iframe> tags are matched, since blocks.ts
// splits the body into lines before this runs on each one.
const TOKEN_PATTERN =
  /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|<iframe\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>[\s\S]*?<\/iframe>|(https?:\/\/\S+)/gi;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    if (match[2] !== undefined) {
      // Image syntax: ![alt](url) -- match[1] is the alt text, match[2]
      // is the URL.
      tokens.push({ type: "image", value: match[2], alt: match[1] });
    } else if (match[3] !== undefined) {
      // <iframe src="..."> embed -- match[3] is the src. Falls back to
      // rendering the raw tag text if the host isn't on the allowlist,
      // rather than silently dropping it or embedding an untrusted origin.
      if (isAllowedIframeSrc(match[3])) {
        tokens.push({ type: "iframe", value: match[3] });
      } else {
        tokens.push({ type: "text", value: match[0] });
      }
    } else {
      tokens.push({ type: "link", value: match[4] });
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
