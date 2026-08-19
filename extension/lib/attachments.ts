// Uploads a pasted image to the "attachments" collection and returns
// its public file URL for inline embedding via markdown image syntax
// (`![](url)`, already parsed by lib/markup/inline.ts -- no parser
// changes needed). Kept as its own file rather than folded into
// lib/annotations.ts since attachments are a separate collection with
// their own lifecycle (cascade-deleted with their annotation via a
// PocketBase-side rule, not application code).
//
// Note: an image pasted while editing is uploaded immediately, before
// the annotation itself is saved. If the edit is then cancelled or the
// note is closed without saving, the uploaded attachment record is
// never referenced from any annotation body -- this is accepted as a
// known tradeoff rather than solved with cleanup logic here.

import { getAuthedPb } from "./pb";

export async function uploadAttachment(
  annotationId: string,
  image: File,
): Promise<string> {
  const pb = await getAuthedPb();
  const record = await pb.collection("attachments").create({
    annotation: annotationId,
    image,
  });
  return pb.files.getURL(record, record.image as string);
}
