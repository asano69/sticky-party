// Toolbar badge + popup Sync button state shown whenever a sync with
// the backend fails -- periodic alarm sync (background.ts), manual
// full sync, Settings save, popup's on-open sync, or a failed
// annotation load (background.ts's checkTab). Cleared as soon as any
// of those succeeds.
//
// browser.action controls the toolbar badge, visible without opening
// the popup. The failure is also mirrored into browser.storage.local
// under SYNC_ERROR_KEY so NavBar.tsx can recolor the popup's own Sync
// button too (see getSyncError) -- useful wherever the toolbar badge
// itself isn't visible (e.g. hidden in a toolbar overflow menu).

const SYNC_ERROR_KEY = "syncError";

export async function showSyncErrorBadge(): Promise<void> {
  browser.action.setBadgeText({ text: "!" });
  browser.action.setBadgeBackgroundColor({ color: "#c0392b" });
  await browser.storage.local.set({ [SYNC_ERROR_KEY]: true });
}

export async function clearSyncErrorBadge(): Promise<void> {
  browser.action.setBadgeText({ text: "" });
  await browser.storage.local.set({ [SYNC_ERROR_KEY]: false });
}

export async function getSyncError(): Promise<boolean> {
  const result = await browser.storage.local.get(SYNC_ERROR_KEY);
  return !!result[SYNC_ERROR_KEY];
}
