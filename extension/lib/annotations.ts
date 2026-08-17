// Fetches every annotation (id + body) whose `target` exactly matches
// `url`. Called only after a cheap local cache hit (see lib/targets.ts),
// so this network round trip only happens for pages that actually have
// an annotation (see docs/architecture.md).
//
// Multiple annotations can share the same target, so this returns all
// matches instead of just the first one. getFullList returns an empty
// array (not a 404) when nothing matches, so there is no stale-target
// error case to handle here.

import { getAuthedPb } from './pb';
import type { AnnotationData } from './messages';

export async function fetchAnnotations(url: string): Promise<AnnotationData[]> {
  const pb = await getAuthedPb();
  const records = await pb.collection('annotations').getFullList<AnnotationData>({
    filter: pb.filter('target = {:url}', { url }),
    // Oldest first, so the most recently edited annotation is rendered
    // last and sits on top when notes overlap (see AnnotationData.updated).
    sort: 'updated',
  });
  // Keep annotations with a title even if the body is empty, since a
  // title alone is now enough content to be worth showing.
  return records.filter((record) => record.body || record.title);
}

// Saves an edited annotation's title and body back to PocketBase. Used
// by the content script's sticky-note Edit/Save flow.
export async function updateAnnotation(
  id: string,
  data: { title: string; body: string },
): Promise<void> {
  const pb = await getAuthedPb();
  await pb.collection('annotations').update(id, data);
}

// Toggles whether an annotation's body is blurred to guard against
// shoulder-surfing. Kept separate from updateAnnotation since it's
// triggered by its own control (the footer's eye/eye-off button), not
// the title/body edit form.
export async function setAnnotationHide(id: string, hide: boolean): Promise<void> {
  const pb = await getAuthedPb();
  await pb.collection('annotations').update(id, { hide });
}

// Deletes an annotation from PocketBase. Used by the sticky note's trash
// button, shown only while editing. The local target-list cache
// (lib/targets.ts) is intentionally left untouched here: other
// annotations may still share the same target, so removing it would
// risk hiding notes that are still valid.
export async function deleteAnnotation(id: string): Promise<void> {
  const pb = await getAuthedPb();
  await pb.collection('annotations').delete(id);
}
