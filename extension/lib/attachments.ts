// Uploads a pasted image to the "attachments" collection, and fetches
// an attachment's image bytes as a Blob URL for inline display.
// Attachments live in their own collection (rather than a file field
// on "annotations" directly) with their own lifecycle -- cascade-
// deleted with their annotation via a PocketBase-side rule, not
// application code.
//
// The image is never referenced by a plain URL in the annotation body
// -- only by the attachment's record id (embedded via the `![[id]]`
// syntax, see lib/markup/inline.ts). The attachments collection's
// viewRule stays auth-gated, so both the record lookup and the raw
// file bytes below are fetched using the viewer's own credentials at
// render time, rather than a plain <img src> (which never carries
// PocketBase's auth headers) or a stored URL with an embedded token
// (which would eventually expire).
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
  return record.id;
}

// Fetches an attachment's image and returns a Blob URL for it. Callers
// must revoke the returned URL (URL.revokeObjectURL) once done with it
// to avoid leaking memory -- see AnnotationBody.tsx's AttachmentImage,
// which does this in onCleanup.
export async function fetchAttachmentBlobUrl(
  attachmentId: string,
): Promise<string> {
  const pb = await getAuthedPb();
  // A normal SDK call, so the Authorization header is attached
  // automatically -- this is what actually enforces the attachments
  // collection's viewRule for the record lookup itself.
  const record = await pb.collection("attachments").getOne(attachmentId);

  // File downloads are a separate, unauthenticated-by-default route:
  // unlike ordinary API calls, PocketBase's file endpoint does NOT
  // check the Authorization header. A protected file (viewRule set)
  // instead requires a short-lived file token as a `?token=` query
  // param, obtained via a dedicated auth'd endpoint. Without it, the
  // download 404s (PocketBase returns 404 rather than 403 for a
  // protected file, so as not to reveal whether it exists).
  const token = await pb.files.getToken();
  const fileUrl = pb.files.getURL(record, record.image as string, { token });

  const res = await fetch(fileUrl);
  if (!res.ok) {
    throw new Error(`Failed to fetch attachment: ${res.status}`);
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
