// Splits a single line of text into plain-text and link tokens. Kept
// separate from blocks.ts so new inline rules (e.g. bold, mentions) can
// be added here without touching block-level parsing.

import type { InlineToken } from "./types";

// Matches http(s) URLs up to the next whitespace character.
const URL_PATTERN = /https?:\/\/\S+/g;

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, start) });
    }
    tokens.push({ type: "link", value: match[0] });
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
