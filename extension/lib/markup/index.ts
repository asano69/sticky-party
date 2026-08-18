// Public entry point for the annotation body markup parser. Consumers
// (e.g. AnnotationBody.tsx) should import from here rather than reaching
// into blocks.ts/inline.ts directly.

export { parseLines, toggleTaskLine, listContinuationPrefix } from "./blocks";
export type { Line, InlineToken } from "./types";
