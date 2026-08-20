// See docs/architecture.md for the full sync design this implements.

import { fetchAnnotations, setAnnotationPin } from "../lib/annotations";
import { getAuthedPb } from "../lib/pb";
import { formatActionTitle } from "../lib/actionTitle";
import { getCachedAnnotationCount } from "../lib/annotationCountCache";
import {
  clearAnnotationCountBadge,
  showAnnotationCountBadge,
  withSyncErrorBadge,
} from "../lib/syncBadge";
import {
  ADD_CACHED_TARGET_MESSAGE,
  CHECK_ANNOTATION_MESSAGE,
  GET_POSITION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  RECHECK_ALL_TABS_MESSAGE,
  SAVE_POSITION_MESSAGE,
  SET_ANNOTATION_PIN_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type AddCachedTargetMessage,
  type CheckAnnotationMessage,
  type PositionMessage,
  type RecheckAllTabsMessage,
} from "../lib/messages";
import { fetchPosition, savePosition } from "../lib/positions";
import {
  addCachedTarget,
  getCachedTargets,
  isTargetMatch,
  normalizeTarget,
  removeCachedTarget,
  syncTargets,
} from "../lib/targets";

export default defineBackground(() => {
  // Keeps the local target cache fresh: a differential sync (only
  // annotations touched since the last sync) once a previous sync
  // exists, falling back to a full sync on the very first run (see
  // lib/targets.ts's syncTargets).
  const sync = async () => {
    try {
      await withSyncErrorBadge(() => syncTargets());
    } catch (err) {
      // Most commonly missing/invalid credentials in Settings, or the
      // backend being unreachable. The popup doesn't surface this on
      // its own since sync runs in the background with no UI open, so
      // the badge is what makes the failure visible. withSyncErrorBadge
      // already retried once before giving up and showing the badge.
      console.error("[sticky-party] target sync failed", err);
      return;
    }
    // A target that just appeared in the cache might match a tab
    // that's already open on that page -- recheckAllTabs (defined
    // below) is what makes that reach the tab, instead of only ever
    // being picked up on that tab's next navigation.
    await recheckAllTabs();
  };

  // Runs once whenever the service worker starts (extension install,
  // browser restart, or SW waking up after being killed).
  sync();

  // browser.alarms wakes the service worker on a schedule even after
  // MV3 kills it for inactivity, so this is what makes periodic sync
  // actually happen in MV3. periodInMinutes: 5 is the practical floor
  // for this API (both Chrome and Firefox round anything shorter up to
  // 1 minute for an installed extension outside of a dev-only relaxed
  // mode), so this is as tight as this backstop can get without
  // abandoning browser.alarms altogether -- see docs/architecture.md
  // for why a persistent timer (setInterval, a kept-alive SSE
  // connection, etc.) isn't an option in MV3. This now only matters as
  // a backstop for cases the realtime target-history subscribe doesn't
  // reach (no page with notes currently open, a fresh browser
  // session, or a dropped SSE connection) -- see
  // docs/target-list-sync.md.
  browser.alarms.create("target-sync", { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "target-sync") sync();
  });

  // Checks `url` against the cached target list and tells tab `tabId`
  // to show or hide its annotation overlay accordingly. Shared by the
  // navigation listener and the content script's own startup ping
  // below, since a content script can finish injecting after
  // tabs.onUpdated already fired and missed it -- otherwise a matching
  // page's annotation only ever appeared after a second navigation
  // (e.g. a full reload).
  //
  // On a normal navigation, both callers fire within milliseconds of
  // each other for the same tab+URL. Without dedupe, that meant two
  // separate authenticate-and-fetch round trips to the backend right
  // as the page itself was still loading; if either one happened to
  // be slow enough to fail under that contention, the sync error
  // badge would flash on for no real reason. inFlightChecks makes the
  // second caller just await the first call's result instead of
  // starting a redundant request.
  const inFlightChecks = new Map<string, Promise<void>>();

  const checkTab = (tabId: number, rawUrl: string): Promise<void> => {
    // Normalize once here so both the cache lookup below and the exact-
    // match DB query in fetchAnnotationBodies line up with the normalized
    // target values written by the popup (see lib/targets.ts).
    const url = normalizeTarget(rawUrl);
    const key = `${tabId}:${url}`;

    const existing = inFlightChecks.get(key);
    if (existing) return existing;

    const promise = runCheckTab(tabId, url).finally(() => {
      inFlightChecks.delete(key);
    });
    inFlightChecks.set(key, promise);
    return promise;
  };

  const runCheckTab = async (tabId: number, url: string) => {
    const targets = await getCachedTargets();

    // Updates this tab's hover-tooltip title with the current page's
    // note count over the last-known total (see lib/actionTitle.ts).
    // Reads the cached total rather than fetching it (see
    // lib/annotationCountCache.ts), so this never adds a network call
    // on top of what runCheckTab already does.
    const updateTitle = async (current?: number) => {
      const total = await getCachedAnnotationCount();
      browser.action.setTitle({
        tabId,
        title: formatActionTitle(total, current),
      });
    };

    if (!isTargetMatch(url, targets)) {
      // Clears any overlay left over from the previous URL. Needed for
      // client-side route changes, where the content script isn't
      // reinjected and so won't reset itself on its own.
      browser.tabs
        .sendMessage(tabId, { type: HIDE_ANNOTATION_MESSAGE })
        .catch(() => {});
      clearAnnotationCountBadge(tabId);
      updateTitle();
      return;
    }

    try {
      // withSyncErrorBadge retries once before it lets a failure
      // through, so a transient hiccup right as the page loads doesn't
      // flash the badge red -- see lib/syncBadge.ts.
      const annotations = await withSyncErrorBadge(async () => {
        const pb = await getAuthedPb();
        return fetchAnnotations(pb, url);
      });
      if (annotations.length === 0) {
        // The cache said this URL had an annotation, but the DB has
        // none -- most likely it was deleted since the last sync (a
        // differential sync can't detect deletions on its own; see
        // lib/targets.ts's syncTargets). Drop it now so future checks
        // skip this URL without a network round trip.
        await removeCachedTarget(url);
        clearAnnotationCountBadge(tabId);
        updateTitle();
        return;
      }
      await browser.tabs.sendMessage(tabId, {
        type: SHOW_ANNOTATION_MESSAGE,
        annotations,
        target: url,
      });
      // Shows how many notes are on screen for this tab, in a neutral
      // dark gray -- distinct from the red sync-error badge, which
      // signals a connection problem rather than note count.
      showAnnotationCountBadge(tabId, annotations.length);
      updateTitle(annotations.length);
    } catch (err) {
      // A matched URL whose annotation body couldn't be loaded (e.g.
      // backend unreachable) is exactly the kind of silent failure the
      // badge exists to surface -- without it, the user would just see
      // no sticky note and have no idea why.
      console.error("[sticky-party] failed to fetch annotation", err);
      clearAnnotationCountBadge(tabId);
      updateTitle();
    }
  };

  // Re-runs checkTab for every open tab against the current target
  // cache. Cheap for tabs whose URL doesn't match any cached target --
  // isTargetMatch inside checkTab/runCheckTab is a local lookup, not a
  // network call -- so this is safe to call after any cache update,
  // not just for the one tab a popup save or manual sync happened to
  // target. This is what lets a target update reach a tab that's
  // already sitting open on a page which only just gained an
  // annotation (see docs/realtime-sync.md's known gap for pages with
  // zero annotations: they mount no orchestrator of their own, so this
  // polling/on-demand path is the only way they ever learn about one).
  const recheckAllTabs = async () => {
    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (tab.id != null && tab.url) checkTab(tab.id, tab.url);
    }
  };

  // Detects navigation -- including client-side route changes that
  // update the tab's URL -- and checks it against the cached target
  // list. No network call unless it actually matches.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    checkTab(tabId, changeInfo.url);
  });

  // Two senders share this listener:
  // - The content script, as soon as it starts running. This fixes the
  //   race above: even if tabs.onUpdated already fired before the
  //   content script was ready to receive its message, this ping
  //   re-checks the same URL once the content script exists.
  // - The popup, right after saving a new annotation, so the sticky
  //   note appears immediately instead of waiting for the next
  //   navigation or periodic full sync. The popup has no sender.tab of
  //   its own, so it passes tabId explicitly.
  browser.runtime.onMessage.addListener(
    (message: CheckAnnotationMessage, sender) => {
      if (message?.type !== CHECK_ANNOTATION_MESSAGE) return;
      const tabId = message.tabId ?? sender.tab?.id;
      if (tabId != null) checkTab(tabId, message.url);
    },
  );

  // Sent by the popup after it refreshes the target cache itself (see
  // entrypoints/popup/App.tsx's checkConfigured/handleSync). Unlike
  // CHECK_ANNOTATION_MESSAGE above, this isn't scoped to one tab: the
  // popup has no way to know which open tabs might match a target it
  // just learned about, so it asks background.ts to recheck all of
  // them.
  browser.runtime.onMessage.addListener((message: RecheckAllTabsMessage) => {
    if (message?.type === RECHECK_ALL_TABS_MESSAGE) recheckAllTabs();
  });

  // Handles GET_POSITION_MESSAGE/SAVE_POSITION_MESSAGE/
  // SET_ANNOTATION_PIN_MESSAGE from content.ts (see lib/messages.ts for
  // why this can't run in the content script itself). Returning a
  // Promise here makes the polyfilled browser.runtime.onMessage resolve
  // the sender's sendMessage() call with whatever
  // fetchPosition/savePosition/setAnnotationPin resolve to.
  browser.runtime.onMessage.addListener((message: PositionMessage) => {
    if (message?.type === GET_POSITION_MESSAGE) {
      return fetchPosition(message.annotationId, message.viewport);
    }
    if (message?.type === SAVE_POSITION_MESSAGE) {
      return savePosition(
        message.annotationId,
        message.position,
        message.viewport,
        message.existingId,
      );
    }
    if (message?.type === SET_ANNOTATION_PIN_MESSAGE) {
      return getAuthedPb().then((pb) =>
        setAnnotationPin(pb, message.annotationId, message.pin, message.coords),
      );
    }
  });

  // Relayed from content.ts (see lib/realtime-messages.ts's
  // TARGET_HISTORY_CREATED_MESSAGE): a new annotation's target appeared
  // somewhere, learned via the realtime-orchestrator's target-agnostic
  // subscribe on "histories" (see docs/target-list-sync.md). Reuses the
  // same write-through helper the popup uses on save (lib/targets.ts),
  // so this just closes the gap between that and the 5-minute periodic
  // sync above.
  browser.runtime.onMessage.addListener((message: AddCachedTargetMessage) => {
    if (message?.type === ADD_CACHED_TARGET_MESSAGE) {
      // A brand new target learned this way might already match a tab
      // that's open on it right now (including one showing zero notes
      // so far -- see recheckAllTabs above), so recheck once the write
      // finishes rather than waiting for this tab's own orchestrator,
      // if it even has one, to notice.
      addCachedTarget(message.target, message.updated).then(recheckAllTabs);
    }
  });
});
