// Read-through/write-through mirror of annotation `target` URLs, used by
// the content script to check for a match without a DB round trip. See
// docs/architecture.md for the full sync design.
//
// Writers: the popup (write-through, addCachedTarget below), a manual
// full sync (fullSyncTargets, e.g. the popup's refresh button), and the
// background script's periodic full sync. Both full syncs overwrite this
// key wholesale via setCachedTargets, not addCachedTarget.

import { getAuthedPb } from './pb';

const TARGETS_KEY = 'cachedTargets';

export async function getCachedTargets(): Promise<string[]> {
  const result = await browser.storage.local.get(TARGETS_KEY);
  return (result[TARGETS_KEY] as string[] | undefined) ?? [];
}

// Strips a single trailing slash so "https://example.com/" and
// "https://example.com" are treated as the same target. Shared by every
// place a target URL is written or compared (popup save, write-through
// cache, and match checks) so the normalization rule never drifts out
// of sync between them.
export function normalizeTarget(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

export async function addCachedTarget(target: string): Promise<void> {
  const normalized = normalizeTarget(target);
  const targets = await getCachedTargets();
  if (targets.includes(normalized)) return;
  await browser.storage.local.set({ [TARGETS_KEY]: [...targets, normalized] });
}

export async function setCachedTargets(targets: string[]): Promise<void> {
  await browser.storage.local.set({ [TARGETS_KEY]: targets });
}

// Whether `url` matches any cached target, ignoring a trailing-slash
// difference (see normalizeTarget). Otherwise matching is exact-equality;
// see docs/architecture.md's "未確定事項" for future match strategies
// (prefix, pattern, etc.) if that turns out to be too strict.
export function isTargetMatch(url: string, targets: string[]): boolean {
  const normalized = normalizeTarget(url);
  return targets.some((target) => normalizeTarget(target) === normalized);
}

// Fetches only the `target` field from every annotation and overwrites
// the local cache wholesale (full sync; see docs/architecture.md). Used
// by the popup's manual refresh button and can be reused by the
// background script's periodic sync.
export async function fullSyncTargets(): Promise<string[]> {
  const pb = await getAuthedPb();
  const records = await pb.collection('annotations').getFullList<{ target: string }>({
    fields: 'target',
  });
  // Multiple annotations can share the same target URL, so dedupe here;
  // otherwise the cached list grows noisy and the match check does
  // redundant work for no benefit.
  const targets = [...new Set(records.map((record) => record.target).filter(Boolean))];
  await setCachedTargets(targets);
  return targets;
}
