// Caches the total annotation count (see lib/annotations.ts's
// fetchAnnotationCount) in browser.storage.local, so background.ts's
// per-tab title update (see entrypoints/background.ts) can read a
// denominator without a network round trip on every navigation --
// matching the same "avoid a DB call on every page" principle as
// lib/targets.ts (see docs/architecture.md). The cache is only ever
// as fresh as the last successful fetchAnnotationCount() call (popup
// open, manual sync, or a new annotation being saved); a page visited
// before any of those calls just shows the title without a
// denominator (see formatActionTitle's total===undefined case).

const COUNT_KEY = "cachedAnnotationCount";

export async function getCachedAnnotationCount(): Promise<number | undefined> {
  const result = await browser.storage.local.get(COUNT_KEY);
  return result[COUNT_KEY] as number | undefined;
}

export async function setCachedAnnotationCount(count: number): Promise<void> {
  await browser.storage.local.set({ [COUNT_KEY]: count });
}
