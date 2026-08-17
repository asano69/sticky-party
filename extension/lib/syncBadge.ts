// Toolbar badge shown whenever a sync with the backend fails --
// periodic alarm sync (background.ts), manual full sync (App.tsx's
// refresh button, Settings.tsx's save), or the popup's on-open sync
// (App.tsx). Cleared as soon as any of those succeeds. Uses
// browser.action, which needs no extra permission since it only
// controls this extension's own toolbar icon.

export function showSyncErrorBadge(): void {
  browser.action.setBadgeText({ text: "!" });
  browser.action.setBadgeBackgroundColor({ color: "#c0392b" });
}

export function clearSyncErrorBadge(): void {
  browser.action.setBadgeText({ text: "" });
}
