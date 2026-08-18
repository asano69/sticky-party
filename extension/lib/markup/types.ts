// Shared types for the annotation body markup parser. Kept separate so
// blocks.ts and inline.ts import the same definitions instead of each
// module declaring its own copy.

export interface InlineToken {
  type: "text" | "link" | "image";
  // The URL for "link"/"image" tokens; the raw text for "text" tokens.
  value: string;
  // Alt text for "image" tokens (from `![alt](url)`); unused otherwise.
  alt?: string;
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
