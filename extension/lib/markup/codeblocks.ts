// Splits a raw annotation body into an ordered sequence of plain-text
// and fenced-code-block segments. Kept separate from blocks.ts/
// inline.ts since a fenced code block (```lang\n...\n```) spans
// multiple raw lines and has to be pulled out *before* per-line
// parsing -- see AnnotationBody.tsx for how each segment is rendered.
//
// Each text segment carries startLine: the index (into
// body.split("\n")) of its first raw line. This lets a text segment's
// locally-parsed Line[] indices (see lib/markup/blocks.ts's
// parseLines) be translated back into indices against the *original*
// body, which toggleTaskLine needs to edit the right line.

export interface TextSegment {
  type: "text";
  raw: string;
  startLine: number;
}

export interface CodeSegment {
  type: "code";
  lang: string;
  source: string;
  // Cache key for this block's server-rendered HTML (see
  // lib/renders.ts and internal/render/render.go's sourceHash) --
  // must compute the exact same hash as the backend, or a cached
  // render will never be found.
  hash: string;
}

export type BodySegment = TextSegment | CodeSegment;

const FENCE_PATTERN = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

export function splitBodySegments(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  let line = 0;

  const advanceLines = (text: string) => {
    line += text.split("\n").length - 1;
  };

  for (const match of body.matchAll(FENCE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      const raw = body.slice(lastIndex, start);
      segments.push({ type: "text", raw, startLine: line });
      advanceLines(raw);
    }

    const [full, lang, source] = match;
    segments.push({
      type: "code",
      lang,
      source,
      hash: codeBlockHash(lang, source),
    });
    advanceLines(full);

    lastIndex = start + full.length;
  }

  // Always emit a trailing text segment, even if empty -- matches
  // parseLines's own handling of an empty string as a single blank
  // line, so a body ending right after a code fence doesn't lose its
  // (empty) final line.
  segments.push({ type: "text", raw: body.slice(lastIndex), startLine: line });

  return segments;
}

// FNV-1a (64-bit), matching internal/render/render.go's sourceHash
// byte-for-byte. Deliberately not a cryptographic hash (no Web Crypto
// needed): this is just a stable cache key, not a security boundary,
// so the simplest algorithm both Go's stdlib and plain JS can compute
// synchronously and identically wins.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

function codeBlockHash(lang: string, source: string): string {
  // "code\0lang\0source" mirrors the Go side's
  // h.Write([]byte(kind)); h.Write([]byte{0}); ... sequence -- only
  // fence tags that map to kindForLang's default ("code") are hashed
  // here; mermaid/latex fences simply never match a cached render
  // client-side yet, and fall back to plain text (see AnnotationBody.tsx).
  const bytes = new TextEncoder().encode(`code\u0000${lang}\u0000${source}`);
  let hash = FNV_OFFSET;
  for (const byte of bytes) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK64;
  }
  return hash.toString(16);
}
