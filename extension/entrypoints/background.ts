// See docs/architecture.md for the full sync design this implements.

import { fetchAnnotations, setAnnotationPin } from "../lib/annotations";
import { withSyncErrorBadge } from "../lib/syncBadge";
import {
  CHECK_ANNOTATION_MESSAGE,
  GET_POSITION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SAVE_POSITION_MESSAGE,
  SET_ANNOTATION_PIN_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type CheckAnnotationMessage,
  type PositionMessage,
} from "../lib/messages";
import { fetchPosition, savePosition } from "../lib/positions";
import {
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
    }
  };

  // Runs once whenever the service worker starts (extension install,
  // browser restart, or SW waking up after being killed).
  sync();

  // browser.alarms wakes the service worker on a schedule even after
  // MV3 kills it for inactivity, so this is what makes periodic sync
  // actually happen in MV3.
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

    if (!isTargetMatch(url, targets)) {
      // Clears any overlay left over from the previous URL. Needed for
      // client-side route changes, where the content script isn't
      // reinjected and so won't reset itself on its own.
      browser.tabs
        .sendMessage(tabId, { type: HIDE_ANNOTATION_MESSAGE })
        .catch(() => {});
      return;
    }

    try {
      // withSyncErrorBadge retries once before it lets a failure
      // through, so a transient hiccup right as the page loads doesn't
      // flash the badge red -- see lib/syncBadge.ts.
      const annotations = await withSyncErrorBadge(() =>
        fetchAnnotations(url),
      );
      if (annotations.length === 0) {
        // The cache said this URL had an annotation, but the DB has
        // none -- most likely it was deleted since the last sync (a
        // differential sync can't detect deletions on its own; see
        // lib/targets.ts's syncTargets). Drop it now so future checks
        // skip this URL without a network round trip.
        await removeCachedTarget(url);
        return;
      }
      await browser.tabs.sendMessage(tabId, {
        type: SHOW_ANNOTATION_MESSAGE,
        annotations,
      });
    } catch (err) {
      // A matched URL whose annotation body couldn't be loaded (e.g.
      // backend unreachable) is exactly the kind of silent failure the
      // badge exists to surface -- without it, the user would just see
      // no sticky note and have no idea why.
      console.error("[sticky-party] failed to fetch annotation", err);
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
      return setAnnotationPin(
        message.annotationId,
        message.pin,
        message.coords,
      );
    }
  });
});
