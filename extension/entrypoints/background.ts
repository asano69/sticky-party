// See docs/architecture.md for the full sync design this implements.

import { fetchAnnotations } from '../lib/annotations';
import {
  CHECK_ANNOTATION_MESSAGE,
  GET_POSITION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SAVE_POSITION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type CheckAnnotationMessage,
  type PositionMessage,
} from '../lib/messages';
import { fetchPosition, savePosition } from '../lib/positions';
import { fullSyncTargets, getCachedTargets, isTargetMatch, normalizeTarget } from '../lib/targets';

export default defineBackground(() => {
  // Full sync: pull the current target list from PocketBase and
  // overwrite the local cache wholesale.
  const fullSync = async () => {
    try {
      await fullSyncTargets();
    } catch (err) {
      // Most commonly missing/invalid credentials in Settings; the popup
      // surfaces that separately, so just log here.
      console.error('[sticky-party] full sync failed', err);
    }
  };

  // Runs once whenever the service worker starts (extension install,
  // browser restart, or SW waking up after being killed).
  fullSync();

  // browser.alarms wakes the service worker on a schedule even after
  // MV3 kills it for inactivity, so this is what makes periodic full
  // sync actually happen in MV3.
  browser.alarms.create('full-sync', { periodInMinutes: 5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'full-sync') fullSync();
  });

  // Checks `url` against the cached target list and tells tab `tabId`
  // to show or hide its annotation overlay accordingly. Shared by the
  // navigation listener and the content script's own startup ping
  // below, since a content script can finish injecting after
  // tabs.onUpdated already fired and missed it -- otherwise a matching
  // page's annotation only ever appeared after a second navigation
  // (e.g. a full reload).
  const checkTab = async (tabId: number, rawUrl: string) => {
    // Normalize once here so both the cache lookup below and the exact-
    // match DB query in fetchAnnotationBodies line up with the normalized
    // target values written by the popup (see lib/targets.ts).
    const url = normalizeTarget(rawUrl);
    const targets = await getCachedTargets();

    if (!isTargetMatch(url, targets)) {
      // Clears any overlay left over from the previous URL. Needed for
      // client-side route changes, where the content script isn't
      // reinjected and so won't reset itself on its own.
      browser.tabs.sendMessage(tabId, { type: HIDE_ANNOTATION_MESSAGE }).catch(() => {});
      return;
    }

    try {
      const annotations = await fetchAnnotations(url);
      if (annotations.length === 0) return;
      await browser.tabs.sendMessage(tabId, { type: SHOW_ANNOTATION_MESSAGE, annotations });
    } catch (err) {
      console.error('[sticky-party] failed to fetch annotation', err);
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
  browser.runtime.onMessage.addListener((message: CheckAnnotationMessage, sender) => {
    if (message?.type !== CHECK_ANNOTATION_MESSAGE) return;
    const tabId = message.tabId ?? sender.tab?.id;
    if (tabId != null) checkTab(tabId, message.url);
  });

  // Handles GET_POSITION_MESSAGE/SAVE_POSITION_MESSAGE from content.ts
  // (see lib/messages.ts for why this can't run in the content script
  // itself). Returning a Promise here makes the polyfilled
  // browser.runtime.onMessage resolve the sender's sendMessage() call
  // with whatever fetchPosition/savePosition resolve to.
  browser.runtime.onMessage.addListener((message: PositionMessage) => {
    if (message?.type === GET_POSITION_MESSAGE) {
      return fetchPosition(message.annotationId, message.viewport);
    }
    if (message?.type === SAVE_POSITION_MESSAGE) {
      return savePosition(message.annotationId, message.position, message.viewport, message.existingId);
    }
  });
});
