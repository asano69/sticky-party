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

// Delay before retrying a failed backend request, before the badge is
// shown. Short on purpose: this only needs to absorb a request that
// fails right as the page/service worker is still starting up, not a
// genuinely down backend.
const RETRY_DELAY_MS = 400;

// Runs `fn` (a backend request) and keeps the sync-error badge in sync
// with the outcome: cleared on success, but only shown once a second
// attempt also fails. A single quick retry means a transient failure
// right as a page loads doesn't flash the badge red for something that
// resolves a moment later. This is the shared policy for every call
// site that talks to the backend (see background.ts and App.tsx) --
// each of them used to have its own try/catch +
// showSyncErrorBadge/clearSyncErrorBadge pair with no retry at all.
export async function withSyncErrorBadge<T>(fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn();
    clearSyncErrorBadge();
    return result;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const result = await fn();
      clearSyncErrorBadge();
      return result;
    } catch (err) {
      showSyncErrorBadge();
      throw err;
    }
  }
}
