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
// Timestamp of the last successful sync, used by syncTargets to fetch
// only annotations touched since then instead of the full list every
// time.
const LAST_SYNC_KEY = "targetsLastSyncedAt";

// PocketBase's filter engine expects datetime literals formatted as
// "YYYY-MM-DD HH:MM:SS.sssZ" -- a space between date and time, not
// full ISO 8601's "T" separator. Passing a "T"-separated string into
// a filter's date comparison (see syncTargets below) doesn't error,
// but silently falls back to a plain string comparison against the
// DB's own space-separated representation, which never evaluates
// true -- so every annotation created after the first sync would be
// permanently invisible to the "updated > {:since}" filter. Always
// convert through here before storing or filtering on a timestamp.
function toPbDateTime(iso: string): string {
  return iso.replace("T", " ");
}

async function getLastSyncedAt(): Promise<string | undefined> {
  const result = await browser.storage.local.get(LAST_SYNC_KEY);
  return result[LAST_SYNC_KEY] as string | undefined;
}

async function setLastSyncedAt(iso: string): Promise<void> {
  await browser.storage.local.set({ [LAST_SYNC_KEY]: iso });
}

// A cached target paired with the `updated` timestamp of the annotation
// it came from, so the popup's Targets list (Targets.tsx) can sort by
// recency without a separate DB round trip.
export interface CachedTarget {
  target: string;
  updated: string;
}

export async function getCachedTargets(): Promise<CachedTarget[]> {
  const result = await browser.storage.local.get(TARGETS_KEY);
  return (result[TARGETS_KEY] as CachedTarget[] | undefined) ?? [];
}

// Strips a single trailing slash so "https://example.com/" and
// "https://example.com" are treated as the same target. Shared by every
// place a target URL is written or compared (popup save, write-through
// cache, and match checks) so the normalization rule never drifts out
// of sync between them.
export function normalizeTarget(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

// Whether `url` is a well-formed http:// or https:// URL. Used by the
// popup's save form (Home.tsx) to reject other schemes (e.g.
// "javascript:", "ftp://", or plain unparsable text) before it ever
// reaches the DB or the local target cache.
export function isValidHttpUrl(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export async function addCachedTarget(
  target: string,
  updated: string,
): Promise<void> {
  const normalized = normalizeTarget(target);
  const targets = await getCachedTargets();
  // Replace any existing entry for this target rather than skipping,
  // so re-saving an annotation on the same URL refreshes its updated
  // timestamp too.
  const next = targets.filter((t) => normalizeTarget(t.target) !== normalized);
  next.push({ target: normalized, updated });
  await browser.storage.local.set({ [TARGETS_KEY]: next });
}

// Removes a single target from the cache. Used when a page matches the
// cache but the DB turns out to have no annotation for it (see
// background.ts's checkTab) -- the most likely explanation is that the
// annotation was deleted after the last sync, since syncTargets's
// differential fetch can't detect deletions on its own.
export async function removeCachedTarget(target: string): Promise<void> {
  const normalized = normalizeTarget(target);
  const targets = await getCachedTargets();
  const next = targets.filter((t) => normalizeTarget(t.target) !== normalized);
  if (next.length !== targets.length) {
    await browser.storage.local.set({ [TARGETS_KEY]: next });
  }
}

export async function setCachedTargets(targets: CachedTarget[]): Promise<void> {
  await browser.storage.local.set({ [TARGETS_KEY]: targets });
}

// Whether `url` matches any cached target, ignoring a trailing-slash
// difference (see normalizeTarget). Otherwise matching is exact-equality;
// see docs/architecture.md's "未確定事項" for future match strategies
// (prefix, pattern, etc.) if that turns out to be too strict.
export function isTargetMatch(url: string, targets: CachedTarget[]): boolean {
  const normalized = normalizeTarget(url);
  return targets.some((t) => normalizeTarget(t.target) === normalized);
}

// Fetches only the `target` field from every annotation and overwrites
// the local cache wholesale. Used for the initial sync (no previous
// sync to diff against -- see syncTargets below) and by the popup's
// manual refresh button, which wants a guaranteed full resync rather
// than a differential one.
export async function fullSyncTargets(): Promise<CachedTarget[]> {
  // Captured before the fetch so a later differential sync (syncTargets)
  // starts from this point, not from whenever the fetch happened to
  // finish. Converted to PocketBase's expected datetime format --
  // see toPbDateTime above -- since this value is later fed straight
  // into a filter's date comparison.
  const startedAt = toPbDateTime(new Date().toISOString());

  const pb = await getAuthedPb();
  const records = await pb
    .collection("annotations")
    .getFullList<{ target: string; updated: string }>({
      fields: "target,updated",
      // Ascending, so when multiple annotations share a target the
      // later (more recent) record overwrites the earlier one below.
      sort: "updated",
    });
  // Multiple annotations can share the same target URL; keep only the
  // most recently updated one per target so the popup's Targets list
  // can sort by recency.
  const byTarget = new Map<string, string>();
  for (const record of records) {
    if (record.target) byTarget.set(record.target, record.updated);
  }
  const targets: CachedTarget[] = [...byTarget].map(([target, updated]) => ({
    target,
    updated,
  }));
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
export async function syncTargets(): Promise<CachedTarget[]> {
  const since = await getLastSyncedAt();
  if (!since) return fullSyncTargets();

  // Captured before the fetch, for the same reason as in
  // fullSyncTargets: the next sync should start from here, not from
  // whenever this fetch happened to finish. Same format conversion as
  // fullSyncTargets -- see toPbDateTime above.
  const startedAt = toPbDateTime(new Date().toISOString());

  const pb = await getAuthedPb();
  const records = await pb
    .collection("annotations")
    .getFullList<{ target: string; updated: string }>({
      filter: pb.filter("updated > {:since}", { since }),
      fields: "target,updated",
      // Ascending, same reasoning as fullSyncTargets: a later record
      // for the same target overwrites the earlier one in the map.
      sort: "updated",
    });

  const merged = new Map(
    (await getCachedTargets()).map((t) => [t.target, t.updated]),
  );
  for (const record of records) {
    if (record.target) merged.set(record.target, record.updated);
  }
  const targets: CachedTarget[] = [...merged].map(([target, updated]) => ({
    target,
    updated,
  }));
  await setCachedTargets(targets);
  await setLastSyncedAt(startedAt);
  return targets;
}
