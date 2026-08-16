// Fetches the body text of every annotation whose `target` exactly
// matches `url`. Called only after a cheap local cache hit (see
// lib/targets.ts), so this network round trip only happens for pages
// that actually have an annotation (see docs/architecture.md).
//
// Multiple annotations can share the same target, so this returns all
// matching bodies instead of just the first one. getFullList returns an
// empty array (not a 404) when nothing matches, so there is no stale-
// target error case to handle here.

import { getAuthedPb } from './pb';

export async function fetchAnnotationBodies(url: string): Promise<string[]> {
  const pb = await getAuthedPb();
  const records = await pb.collection('annotations').getFullList<{ body: string }>({
    filter: pb.filter('target = {:url}', { url }),
  });
  return records.map((record) => record.body).filter(Boolean);
}
