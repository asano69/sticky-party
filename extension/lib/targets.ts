// Read-through/write-through mirror of annotation `target` URLs, used by
// the content script to check for a match without a DB round trip. See
// docs/architecture.md for the full sync design.
//
// Writers: the popup (write-through, addCachedTarget below), a manual
// full sync (fullSyncTargets, e.g. the popup's refresh button), and the
// background script's periodic full sync. Both full syncs overwrite this
// key wholesale via setCachedTargets, not addCachedTarget.

import { getAuthedPb } from "./pb";

const TARGETS_KEY = "cachedTargets";
// Timestamp (ISO 8601, UTC) of the last successful sync, used by
// syncTargets to fetch only annotations touched since then instead of
// the full list every time.
const LAST_SYNC_KEY = "targetsLastSyncedAt";

async function getLastSyncedAt(): Promise<string | undefined> {
  const result = await browser.storage.local.get(LAST_SYNC_KEY);
  return result[LAST_SYNC_KEY] as string | undefined;
}

async function setLastSyncedAt(iso: string): Promise<void> {
  await browser.storage.local.set({ [LAST_SYNC_KEY]: iso });
}

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
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export async function addCachedTarget(target: string): Promise<void> {
  const normalized = normalizeTarget(target);
  const targets = await getCachedTargets();
  if (targets.includes(normalized)) return;
  await browser.storage.local.set({ [TARGETS_KEY]: [...targets, normalized] });
}

// Removes a single target from the cache. Used when a page matches the
// cache but the DB turns out to have no annotation for it (see
// background.ts's checkTab) -- the most likely explanation is that the
// annotation was deleted after the last sync, since syncTargets's
// differential fetch can't detect deletions on its own.
export async function removeCachedTarget(target: string): Promise<void> {
  const normalized = normalizeTarget(target);
  const targets = await getCachedTargets();
  const next = targets.filter((t) => normalizeTarget(t) !== normalized);
  if (next.length !== targets.length) {
    await browser.storage.local.set({ [TARGETS_KEY]: next });
  }
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
// the local cache wholesale. Used for the initial sync (no previous
// sync to diff against -- see syncTargets below) and by the popup's
// manual refresh button, which wants a guaranteed full resync rather
// than a differential one.
export async function fullSyncTargets(): Promise<string[]> {
  // Captured before the fetch so a later differential sync (syncTargets)
  // starts from this point, not from whenever the fetch happened to
  // finish.
  const startedAt = new Date().toISOString();

  const pb = await getAuthedPb();
  const records = await pb
    .collection("annotations")
    .getFullList<{ target: string }>({
      fields: "target",
    });
  // Multiple annotations can share the same target URL, so dedupe here;
  // otherwise the cached list grows noisy and the match check does
  // redundant work for no benefit.
  const targets = [
    ...new Set(records.map((record) => record.target).filter(Boolean)),
  ];
  await setCachedTargets(targets);
  await setLastSyncedAt(startedAt);
  return targets;
}

// Incrementally syncs the target cache: fetches only annotations whose
// `updated` timestamp is newer than the last sync, instead of every
// annotation. Falls back to fullSyncTargets when there is no previous
// sync to diff against (e.g. right after install).
//
// This can only add/refresh targets, never remove them: a filter on
// `updated` can't see records that no longer exist, so a deleted
// annotation's target isn't caught here. Instead, a stale target is
// removed lazily, the next time a page actually matches it and the DB
// turns out to have no annotation (see removeCachedTarget and
// background.ts's checkTab). Until then it's a harmless false positive.
export async function syncTargets(): Promise<string[]> {
  const since = await getLastSyncedAt();
  if (!since) return fullSyncTargets();

  // Captured before the fetch, for the same reason as in
  // fullSyncTargets: the next sync should start from here, not from
  // whenever this fetch happened to finish.
  const startedAt = new Date().toISOString();

  const pb = await getAuthedPb();
  const records = await pb
    .collection("annotations")
    .getFullList<{ target: string }>({
      filter: pb.filter("updated > {:since}", { since }),
      fields: "target",
    });

  const merged = new Set(await getCachedTargets());
  for (const record of records) {
    if (record.target) merged.add(record.target);
  }
  const targets = [...merged];
  await setCachedTargets(targets);
  await setLastSyncedAt(startedAt);
  return targets;
}
