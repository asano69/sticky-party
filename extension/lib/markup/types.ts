// Shared types for the annotation body markup parser. Kept separate so
// blocks.ts and inline.ts import the same definitions instead of each
// module declaring its own copy.

export interface InlineToken {
  type: "text" | "link";
  value: string;
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
