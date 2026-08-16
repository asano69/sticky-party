// Read-through/write-through mirror of annotation `target` URLs, used by
// the content script to check for a match without a DB round trip. See
// docs/architecture.md for the full sync design.
//
// Only two writers are allowed: the popup (write-through, addCachedTarget
// below) and the background script's periodic full sync (which should
// overwrite this key wholesale, not use addCachedTarget).

const TARGETS_KEY = 'cachedTargets';

export async function getCachedTargets(): Promise<string[]> {
  const result = await browser.storage.local.get(TARGETS_KEY);
  return (result[TARGETS_KEY] as string[] | undefined) ?? [];
}

export async function addCachedTarget(target: string): Promise<void> {
  const targets = await getCachedTargets();
  if (targets.includes(target)) return;
  await browser.storage.local.set({ [TARGETS_KEY]: [...targets, target] });
}
