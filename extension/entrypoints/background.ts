// See docs/architecture.md for the full sync design this implements.

import { fetchAnnotationBodies } from '../lib/annotations';
import {
  CHECK_ANNOTATION_MESSAGE,
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
  type CheckAnnotationMessage,
} from '../lib/messages';
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
      console.error('[web-anno] full sync failed', err);
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
      const bodies = await fetchAnnotationBodies(url);
      if (bodies.length === 0) return;
      await browser.tabs.sendMessage(tabId, { type: SHOW_ANNOTATION_MESSAGE, bodies });
    } catch (err) {
      console.error('[web-anno] failed to fetch annotation', err);
    }
  };

  // Detects navigation -- including client-side route changes that
  // update the tab's URL -- and checks it against the cached target
  // list. No network call unless it actually matches.
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo.url) return;
    checkTab(tabId, changeInfo.url);
  });

  // The content script sends this as soon as it starts running. This is
  // what actually fixes the race above: even if tabs.onUpdated already
  // fired before the content script was ready to receive its message,
  // this ping re-checks the same URL once the content script exists.
  browser.runtime.onMessage.addListener((message: CheckAnnotationMessage, sender) => {
    if (message?.type === CHECK_ANNOTATION_MESSAGE && sender.tab?.id != null) {
      checkTab(sender.tab.id, message.url);
    }
  });
});
