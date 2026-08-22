import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import Home from "./Home";
import Settings from "./Settings";
import Targets from "./Targets";
import NavBar, { type View } from "./NavBar";
import { fullSyncTargets, syncTargets } from "../../lib/targets";
import { fetchAnnotationCount } from "../../lib/annotations";
import { getAuthedPb } from "../../lib/pb";
import { formatActionTitle } from "../../lib/actionTitle";
import { getSettings } from "../../lib/settings";
import { getSyncError, withSyncErrorBadge } from "../../lib/syncBadge";
import { log } from "../../lib/log";
import {
  applyPopupColor,
  getPopupColor,
  savePopupColor,
} from "../../lib/popupColor";
import { DEFAULT_NOTE_COLOR, type NoteColor } from "../../lib/colors";
import {
  RECHECK_ALL_TABS_MESSAGE,
  type RecheckAllTabsMessage,
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
  // Popup's background theme color, driven by the color picker in
  // Home.tsx's footer. Lives here (not in Home) so it applies to the
  // whole popup regardless of which view is active, and persists
  // across reopens via lib/popupColor.ts.
  const [bgColor, setBgColor] = createSignal<NoteColor>(DEFAULT_NOTE_COLOR);

  // Loads the persisted popup color and applies it immediately. Kept
  // separate from checkConfigured's onMount below since this doesn't
  // depend on backend credentials.
  onMount(async () => {
    const saved = await getPopupColor();
    setBgColor(saved);
    applyPopupColor(saved);
  });

  // Called from Home.tsx's color picker: updates the popup's
  // background right away and persists the choice for next time.
  const handleBgColorChange = (color: NoteColor) => {
    setBgColor(color);
    applyPopupColor(color);
    savePopupColor(color);
  };

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
      // A target that only just appeared in the cache (e.g. someone
      // else annotated this page moments ago) might already match a
      // tab sitting open on it -- ask background.ts to recheck every
      // open tab so that tab's overlay updates immediately instead of
      // waiting for its next navigation.
      browser.runtime.sendMessage({
        type: RECHECK_ALL_TABS_MESSAGE,
      } satisfies RecheckAllTabsMessage);
    } catch (err) {
      log.error("popup sync failed", { err });
      setSyncError(true);
    }

    try {
      setAnnotationCount(await fetchAnnotationCount(await getAuthedPb()));
    } catch (err) {
      // Not routed through the sync-error badge: a failed count fetch
      // is minor compared to a failed target sync, so it just logs and
      // leaves the previous count (if any) displayed.
      log.error("failed to fetch annotation count", { err });
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

  // Manual full sync (fetch every target from PocketBase, overwrite the
  // local cache) on top of the automatic write-through/periodic sync.
  // Lives here (rather than in Targets.tsx) since it's a global action,
  // not specific to the cached-URLs view.
  //
  // After refreshing the cache, also ask background.ts to recheck
  // every open tab (RECHECK_ALL_TABS_MESSAGE): a stale cache may have
  // been hiding/showing the wrong notes on any of them, and without
  // this the fix would only take effect on the next navigation
  // instead of immediately.
  const handleSync = async () => {
    setSyncing(true);
    try {
      await withSyncErrorBadge(() => fullSyncTargets());
      setSyncError(false);
      browser.runtime.sendMessage({
        type: RECHECK_ALL_TABS_MESSAGE,
      } satisfies RecheckAllTabsMessage);
      // Manual sync is also a natural moment to refresh the displayed
      // count (e.g. after annotations were added/removed elsewhere).
      setAnnotationCount(await fetchAnnotationCount(await getAuthedPb()));
    } catch (err) {
      log.error("full sync failed", { err });
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
      setAnnotationCount(await fetchAnnotationCount(await getAuthedPb()));
    } catch (err) {
      log.error("failed to refresh annotation count", { err });
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
        color={bgColor()}
        onColorChange={handleBgColorChange}
      />

      <Show
        when={view() === "home"}
        fallback={
          <Show when={view() === "settings"} fallback={<Targets />}>
            <Settings onSaved={checkConfigured} />
          </Show>
        }
      >
        <Home onAnnotationCreated={handleAnnotationCreated} color={bgColor()} />
      </Show>
    </div>
  );
}

export default App;
