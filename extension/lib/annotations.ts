// Fetches the body text of the annotation whose `target` exactly matches
// `url`. Called only after a cheap local cache hit (see lib/targets.ts),
// so this network round trip only happens for pages that actually have
// an annotation (see docs/architecture.md).

import { ClientResponseError } from 'pocketbase';

import { getAuthedPb } from './pb';

export async function fetchAnnotationBody(url: string): Promise<string | undefined> {
  const pb = await getAuthedPb();
  try {
    const record = await pb
      .collection('annotations')
      .getFirstListItem<{ body: string }>(pb.filter('target = {:url}', { url }));
    return record.body;
  } catch (err) {
    // 404 means the cached target is stale (e.g. the annotation was
    // deleted since the last full sync) -- not an error worth surfacing.
    if (err instanceof ClientResponseError && err.status === 404) return undefined;
    throw err;
  }
}
