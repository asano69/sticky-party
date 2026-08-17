import { createSignal, onMount, Show } from "solid-js";
import Home from "./Home";
import Settings from "./Settings";
import Targets from "./Targets";
import NavBar, { type View } from "./NavBar";
import { fullSyncTargets, syncTargets } from "../../lib/targets";
import { getSettings } from "../../lib/settings";
import { clearSyncErrorBadge, showSyncErrorBadge } from "../../lib/syncBadge";
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
      await syncTargets();
      clearSyncErrorBadge();
    } catch (err) {
      console.error("[sticky-party] popup sync failed", err);
      showSyncErrorBadge();
    }
  };

  onMount(checkConfigured);

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
      await fullSyncTargets();
      clearSyncErrorBadge();
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
    } catch (err) {
      console.error("[sticky-party] full sync failed", err);
      showSyncErrorBadge();
    } finally {
      setSyncing(false);
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
      />

      <Show
        when={view() === "home"}
        fallback={
          <Show when={view() === "settings"} fallback={<Targets />}>
            <Settings onSaved={checkConfigured} />
          </Show>
        }
      >
        <Home />
      </Show>
    </div>
  );
}

export default App;
