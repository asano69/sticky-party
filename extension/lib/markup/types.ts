// Shared types for the annotation body markup parser. Kept separate so
// blocks.ts and inline.ts import the same definitions instead of each
// module declaring its own copy.

export interface InlineToken {
  type: "text" | "link" | "image" | "iframe";
  // The URL for "link"/"image" tokens, or the src for "iframe" tokens;
  // the raw text for "text" tokens.
  value: string;
  // Alt text for "image" tokens (from `![alt](url)`); unused otherwise.
  alt?: string;
  // Width/height (in px) read from the pasted <iframe> tag's own
  // width/height attributes, if present. Used to preserve the embed's
  // original aspect ratio (e.g. Google Maps' near-square embeds vs
  // YouTube's 16:9) instead of forcing every iframe token to the same
  // ratio. Undefined when the tag had no such attributes.
  width?: number;
  height?: number;
}

export interface Line {
  bullet: boolean;
  // Set for task list lines ("- [ ] ..." / "- [x] ..."); undefined for
  // non-task lines. When set, AnnotationBody renders a checkbox instead
  // of the bullet dot, regardless of `bullet` (which is always false
  // for task lines -- see parseLines in blocks.ts).
  checked?: boolean;
  tokens: InlineToken[];
}
