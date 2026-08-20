// Reads and writes a sticky note's shared position, size, pin state,
// and stacking order in the `positions` collection.
//
// Shared across every viewer now (no more per-user `user` field): x/y
// are stored as ratios of the whole document, not the viewport, so a
// note renders at the same relative spot for everyone regardless of
// window size. width/height are stored in rem rather than raw pixels,
// so a note's on-screen size stays proportionally consistent across
// viewers with different root font sizes. z is a shared stacking
// order: whichever viewer last brought a note to front decides its
// place in the stack for everyone.
//
// This module runs in the background script, not the content script
// (see lib/messages.ts for why), which has no DOM of its own. Unlike
// the old per-user version, it therefore never touches document size
// or rem/px conversion itself -- all of that is document-relative math
// that belongs to content.ts, which has the real `document` to compute
// it with (see entrypoints/content/mountNote.ts). This module just
// passes the already-normalized fields straight through to PocketBase.
//
// pin (fixed vs. absolute) now lives here too, alongside x/y/width/
// height/z, rather than as separate fields on the annotation record --
// see docs/architecture.md. The ratio's basis (document vs. viewport)
// depends on pin mode -- see entrypoints/content/mountNote.ts and
// entrypoints/content/viewport.ts for where that's applied.

import { ClientResponseError } from "pocketbase";

import { getAuthedPb } from "./pb";

export interface PositionData {
  // Whether this note follows the viewport (position: fixed) or stays
  // anchored to a point in the page (position: absolute). x/y use the
  // same document-relative ratio either way -- see mountNote.ts's
  // header comment for why toggling pin needs no coordinate math.
  pin: boolean;
  x: number; // ratio of document width, 0-1
  y: number; // ratio of document height, 0-1
  width: number; // rem
  height: number; // rem
  z: number;
}

export interface StoredPosition extends PositionData {
  id: string;
}

// Fetches the shared position for an annotation, if any.
export async function fetchPosition(
  annotationId: string,
): Promise<StoredPosition | undefined> {
  const pb = await getAuthedPb();
  try {
    return await pb
      .collection("positions")
      .getFirstListItem<StoredPosition>(
        pb.filter("annotation = {:annotation}", { annotation: annotationId }),
      );
  } catch (err) {
    // getFirstListItem throws a 404 when no record matches; no saved
    // position yet is a normal case, not an error.
    if (err instanceof ClientResponseError && err.status === 404)
      return undefined;
    throw err;
  }
}

// Saves the shared position/size/pin/z for an annotation. Pass the id
// returned by a previous fetchPosition/savePosition call to update
// that record instead of creating a new one.
export async function savePosition(
  annotationId: string,
  pos: PositionData,
  existingId?: string,
): Promise<string> {
  const pb = await getAuthedPb();
  const data = { annotation: annotationId, ...pos };

  if (existingId) {
    await pb.collection("positions").update(existingId, data);
    return existingId;
  }

  const created = await pb
    .collection("positions")
    .create<StoredPosition>(data);
  return created.id;
}
