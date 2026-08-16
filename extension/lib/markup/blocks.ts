// Splits annotation body text into lines, detecting bullet markers
// ("* " or "- " at the start of a line) and delegating the rest of each
// line to inline.ts. New block-level rules (e.g. headings) belong here.

import { parseInline } from "./inline";
import type { Line } from "./types";

// A bullet marker is "*" or "-" followed by at least one whitespace
// character; the whitespace is required so "*bold*" or "-5" isn't
// mistaken for a bullet.
const BULLET_PATTERN = /^[*-]\s+(.*)$/;

export function parseLines(body: string): Line[] {
  return body.split("\n").map((raw) => {
    const match = raw.match(BULLET_PATTERN);
    if (match) {
      return { bullet: true, tokens: parseInline(match[1]) };
    }
    return { bullet: false, tokens: parseInline(raw) };
  });
}
