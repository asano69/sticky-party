// Shared types for the annotation body markup parser. Kept separate so
// blocks.ts and inline.ts import the same definitions instead of each
// module declaring its own copy.

export interface InlineToken {
  type: "text" | "link";
  value: string;
}

export interface Line {
  bullet: boolean;
  tokens: InlineToken[];
}
