import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import Home from "./Home";
import Settings from "./Settings";
import Targets from "./Targets";
import NavBar, { type View } from "./NavBar";
import { fullSyncTargets, syncTargets } from "../../lib/targets";
import { fetchAnnotationCount } from "../../lib/annotations";
import { formatActionTitle } from "../../lib/actionTitle";
import { getSettings } from "../../lib/settings";
import { getSyncError, withSyncErrorBadge } from "../../lib/syncBadge";
import {
  CHECK_ANNOTATION_MESSAGE,
  type CheckAnnotationMessage,
} from "../../lib/messages";

// Three-screen popup, switched via NavBar's mode toggle. Home (create an
// annotation) is the default view; Targets (cached URL list) and
// Settings are the other two.
function App() {
  const [view, setView] = createSignal<View>("home");
  const [syncing, setSyncing] = createSignal(false);
  // Locked until backend credentials are confirmed saved (see
  // checkConfigured below). Starts true so Home/Targets can't be
  // interacted with for the brief moment before that check resolves --
  // without credentials, neither view can do anything useful anyway.
  const [locked, setLocked] = createSignal(true);
  // Mirrors lib/syncBadge.ts's stored error flag, so NavBar's Sync
  // button can show the same failure state as the toolbar badge --
  // useful wherever the badge itself isn't visible.
  const [syncError, setSyncError] = createSignal(false);
  // Total annotation count shown next to NavBar's Sync icon. undefined
  // until the first fetch resolves (see checkConfigured/handleSync); a
  // failed fetch leaves the previous value in place rather than
  // clearing it, so the number doesn't flicker away on a transient
  // error.
  const [annotationCount, setAnnotationCount] = createSignal<number>();

  // Reads Settings and unlocks Home/Targets only once backend
  // credentials are actually saved; otherwise forces the Settings view
  // so the user isn't stuck on a Home/Targets screen that can't reach
  // the backend. Re-run after a successful Settings save (see the
  // onSaved prop below) to unlock without requiring a popup reopen.
  const checkConfigured = async () => {
    const settings = await getSettings();
    const configured = !!(
      settings?.backendUrl &&
      settings.email &&
      settings.password
    );
    setLocked(!configured);
    if (!configured) {
      setView("settings");
      return;
    }

    // Opening the popup is a good moment to catch a stale cache early,
    // rather than waiting for the next periodic alarm (see
    // background.ts) -- try a differential sync right away and surface
    // any failure via the same toolbar badge.
    try {
      // withSyncErrorBadge retries once before showing the badge, so a
      // transient hiccup right as the popup opens doesn't flash it red
      // -- see lib/syncBadge.ts.
      await withSyncErrorBadge(() => syncTargets());
      setSyncError(false);
    } catch (err) {
      console.error("[sticky-party] popup sync failed", err);
      setSyncError(true);
    }

    try {
      setAnnotationCount(await fetchAnnotationCount());
    } catch (err) {
      // Not routed through the sync-error badge: a failed count fetch
      // is minor compared to a failed target sync, so it just logs and
      // leaves the previous count (if any) displayed.
      console.error("[sticky-party] failed to fetch annotation count", err);
    }
  };

  onMount(checkConfigured);

  // Mirrors the annotation count into the toolbar icon's hover tooltip
  // (e.g. "Sticky Party (3)"). This must go through browser.action.setTitle,
  // not document.title: document.title only affects this popup page's own
  // title, which doesn't exist yet when the user is hovering the toolbar
  // icon (the popup hasn't been opened). browser.action.setTitle instead
  // sets a property on the action itself, which persists after the popup
  // closes and is what the hover tooltip actually reads.
  createEffect(() => {
    // No tabId here: this is the default title, applied to any tab
    // that hasn't been given its own override by background.ts's
    // runCheckTab (see entrypoints/background.ts) -- e.g. before the
    // first page-match on that tab. There's no per-page numerator to
    // add here since the popup isn't tied to a specific tab's content.
    browser.action.setTitle({ title: formatActionTitle(annotationCount()) });
  });

  // Loads the current error state on open (it may already be true if
  // an earlier alarm-driven sync failed in background.ts before this
  // popup was opened), then keeps it live afterward -- e.g. if that
  // periodic sync succeeds or fails again while this popup happens to
  // still be open.
  onMount(async () => setSyncError(await getSyncError()));
  const onStorageChange = (
    changes: Record<string, { newValue?: unknown }>,
    area: string,
  ) => {
    if (area === "local" && "syncError" in changes) {
      setSyncError(!!changes.syncError.newValue);
    }
  };
  browser.storage.onChanged.addListener(onStorageChange);
  onCleanup(() => browser.storage.onChanged.removeListener(onStorageChange));

  // Ignored while locked (except switching to Settings itself), as a
  // second guard in case something other than NavBar's disabled tabs
  // tries to change the view.
  const handleViewChange = (next: View) => {
    if (locked() && next !== "settings") return;
    setView(next);
  };

  // Manual full sync
  // Manual full sync (fetch every target from PocketBase, overwrite the
  // local cache) on top of the automatic write-through/periodic sync.
  // Lives here (rather than in Targets.tsx) since it's a global action,
  // not specific to the cached-URLs view.
  //
  // After refreshing the cache, also re-run the mount process for the
  // active tab (mirrors Home.tsx's post-save behavior): a stale cache
  // may have been hiding/showing the wrong notes on the current page,
  // and without this the fix would only take effect on the next
  // navigation instead of immediately.
  const handleSync = async () => {
    setSyncing(true);
    try {
      await withSyncErrorBadge(() => fullSyncTargets());
      setSyncError(false);
      const [activeTab] = await browser.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (activeTab?.id != null && activeTab.url) {
        browser.runtime.sendMessage({
          type: CHECK_ANNOTATION_MESSAGE,
          url: activeTab.url,
          tabId: activeTab.id,
        } satisfies CheckAnnotationMessage);
      }
      // Manual sync is also a natural moment to refresh the displayed
      // count (e.g. after annotations were added/removed elsewhere).
      setAnnotationCount(await fetchAnnotationCount());
    } catch (err) {
      console.error("[sticky-party] full sync failed", err);
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };

  // Refreshes the displayed count right after Home.tsx creates a new
  // annotation, so it doesn't wait for the next popup open or manual
  // sync. Not routed through the sync-error badge, same reasoning as
  // checkConfigured's count fetch: a failed refresh here is minor and
  // just leaves the previous count displayed.
  const handleAnnotationCreated = async () => {
    try {
      setAnnotationCount(await fetchAnnotationCount());
    } catch (err) {
      console.error(
        "[sticky-party] failed to refresh annotation count",
        err,
      );
    }
  };

  return (
    <div class="w-[260px]">
      <NavBar
        view={view()}
        onViewChange={handleViewChange}
        syncing={syncing()}
        onSync={handleSync}
        locked={locked()}
        syncError={syncError()}
        count={annotationCount()}
      />

      <Show
        when={view() === "home"}
        fallback={
          <Show when={view() === "settings"} fallback={<Targets />}>
            <Settings onSaved={checkConfigured} />
          </Show>
        }
      >
        <Home onAnnotationCreated={handleAnnotationCreated} />
      </Show>
    </div>
  );
}

export default App;
