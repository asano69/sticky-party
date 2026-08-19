// Fetches every annotation (id + body) whose `target` exactly matches
// `url`. Called only after a cheap local cache hit (see lib/targets.ts),
// so this network round trip only happens for pages that actually have
// an annotation (see docs/architecture.md).
//
// Multiple annotations can share the same target, so this returns all
// matches instead of just the first one. getFullList returns an empty
// array (not a 404) when nothing matches, so there is no stale-target
// error case to handle here.

import type PocketBase from "pocketbase";

import { withReauth } from "./pb";
import { setCachedAnnotationCount } from "./annotationCountCache";
import type { AnnotationData } from "./messages";

// Returns the total annotation count across all targets, without
// fetching any note bodies. perPage: 1 keeps the transferred payload to
// a single record regardless of how many annotations exist; totalItems
// comes from PocketBase's own COUNT(*) query, so this stays cheap even
// with thousands of annotations. No filter is applied, so hidden
// (hide: true) annotations are counted too -- this is a total count,
// not a "visible notes" count.
//
// Also mirrors the result into annotationCountCache, so
// background.ts's per-tab title update (see entrypoints/background.ts)
// can read a denominator without its own network call on every page
// navigation -- every existing caller of this function (App.tsx) keeps
// that cache fresh for free.
export async function fetchAnnotationCount(pb: PocketBase): Promise<number> {
  const result = await withReauth(pb, () =>
    pb.collection("annotations").getList(1, 1, { fields: "id" }),
  );
  await setCachedAnnotationCount(result.totalItems);
  return result.totalItems;
}

export async function fetchAnnotations(
  pb: PocketBase,
  url: string,
): Promise<AnnotationData[]> {
  const records = await withReauth(pb, () =>
    pb.collection("annotations").getFullList<AnnotationData>({
      filter: pb.filter("target = {:url}", { url }),
      // Oldest first, so the most recently edited annotation is rendered
      // last and sits on top when notes overlap (see AnnotationData.updated).
      sort: "updated",
    }),
  );
  // Keep annotations with a title even if the body is empty, since a
  // title alone is now enough content to be worth showing.
  return records.filter((record) => record.body || record.title);
}

// Saves an edited annotation's title and body back to PocketBase. Used
// by the content script's sticky-note Edit/Save flow.
export async function updateAnnotation(
  pb: PocketBase,
  id: string,
  data: { title: string; body: string },
): Promise<void> {
  await withReauth(pb, () => pb.collection("annotations").update(id, data));
}

// Toggles whether an annotation's body is blurred to guard against
// shoulder-surfing. Kept separate from updateAnnotation since it's
// triggered by its own control (the footer's eye/eye-off button), not
// the title/body edit form.
export async function setAnnotationHide(
  pb: PocketBase,
  id: string,
  hide: boolean,
): Promise<void> {
  await withReauth(pb, () =>
    pb.collection("annotations").update(id, { hide }),
  );
}

// Sets an annotation's background color. Kept separate from
// updateAnnotation for the same reason as setAnnotationHide: it's
// triggered by its own control (the footer's palette button), not the
// title/body edit form.
export async function setAnnotationColor(
  pb: PocketBase,
  id: string,
  color: string,
): Promise<void> {
  await withReauth(pb, () =>
    pb.collection("annotations").update(id, { color }),
  );
}

// Pins (or unpins) an annotation to a fixed spot on the page. Unlike
// hide/color above, this is written from content.ts (via the background
// script's SET_ANNOTATION_PIN_MESSAGE handler -- see
// entrypoints/background.ts), not directly from the iframe: only
// content.ts knows the note's on-page pixel position, since it owns the
// wrapper element (see entrypoints/content.ts). `coords` is only passed
// when pinning; unpinning just clears the flag and leaves the previous
// pin coordinates in place (harmless, since they're ignored while pin
// is false).
export async function setAnnotationPin(
  pb: PocketBase,
  id: string,
  pin: boolean,
  coords?: { xRatio: number; yRatio: number; width: number; height: number },
): Promise<void> {
  await withReauth(pb, () =>
    pb.collection("annotations").update(id, {
      pin,
      ...(coords && {
        pinXRatio: coords.xRatio,
        pinYRatio: coords.yRatio,
        pinWidth: coords.width,
        pinHeight: coords.height,
      }),
    }),
  );
}

// Deletes an annotation from PocketBase. Used by the sticky note's trash
// button, shown only while editing. The local target-list cache
// (lib/targets.ts) is intentionally left untouched here: other
// annotations may still share the same target, so removing it would
// risk hiding notes that are still valid.
export async function deleteAnnotation(
  pb: PocketBase,
  id: string,
): Promise<void> {
  await withReauth(pb, () => pb.collection("annotations").delete(id));
}
