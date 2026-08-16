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
  });
  return records.filter((record) => record.body);
}

// Saves an edited annotation body back to PocketBase. Used by the
// content script's sticky-note Edit/Save flow.
export async function updateAnnotationBody(id: string, body: string): Promise<void> {
  const pb = await getAuthedPb();
  await pb.collection('annotations').update(id, { body });
}
