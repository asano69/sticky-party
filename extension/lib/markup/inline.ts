// Splits a single line of text into plain-text, link, and image tokens.
// Kept separate from blocks.ts so new inline rules (e.g. bold, mentions)
// can be added here without touching block-level parsing.

import type { InlineToken } from "./types";

// Matches markdown image syntax (![alt](url)) or a bare http(s) URL up
// to the next whitespace character, whichever comes first. Combined
// into a single pattern -- rather than running two separate passes --
// so an image's own URL is consumed as part of the image match and
// never also matched by the bare-URL alternative afterward. The URL
// inside the image parens stops at the first ")" or whitespace (not
// greedy to the next whitespace like the bare-URL case), so a normal
// closing paren isn't swallowed into the URL itself.
const TOKEN_PATTERN = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/\S+)/g;

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
    } else {
      tokens.push({ type: "link", value: match[3] });
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
