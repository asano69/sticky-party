// Fetches cached, server-rendered HTML for an annotation's fenced code
// blocks (see internal/render/render.go). Read-only: rendering itself
// happens server-side in the create/update hooks on "annotations" --
// nothing here ever writes to the "renders" collection.

import { getAuthedPb } from "./pb";

// Maps a code block's hash (see lib/markup/codeblocks.ts's
// codeBlockHash) to its rendered HTML. A block whose hash isn't in
// this map hasn't been rendered yet (e.g. saved moments ago, before
// the backend hook ran) -- callers fall back to plain text for those.
export async function fetchRenders(
  annotationId: string,
): Promise<Map<string, string>> {
  const pb = await getAuthedPb();
  const records = await pb.collection("renders").getFullList<{
    sourceHash: string;
    html: string;
  }>({
    filter: pb.filter("annotation = {:id} && kind = {:kind}", {
      id: annotationId,
      kind: "code",
    }),
    fields: "sourceHash,html",
  });
  return new Map(records.map((r) => [r.sourceHash, r.html]));
}
