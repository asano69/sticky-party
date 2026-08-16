// See docs/architecture.md for the full sync design this implements.

import { fetchAnnotationBody } from '../lib/annotations';
import {
  HIDE_ANNOTATION_MESSAGE,
  SHOW_ANNOTATION_MESSAGE,
} from '../lib/messages';
import { fullSyncTargets, getCachedTargets, isTargetMatch } from '../lib/targets';

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

  // Detects navigation -- including client-side route changes that
  // update the tab's URL -- and checks it against the cached target
  // list. No network call unless it actually matches.
  browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
    if (!changeInfo.url) return;

    const url = changeInfo.url;
    const targets = await getCachedTargets();

    if (!isTargetMatch(url, targets)) {
      // Clears any overlay left over from the previous URL. Needed for
      // client-side route changes, where the content script isn't
      // reinjected and so won't reset itself on its own.
      browser.tabs.sendMessage(tabId, { type: HIDE_ANNOTATION_MESSAGE }).catch(() => {});
      return;
    }

    try {
      const body = await fetchAnnotationBody(url);
      if (!body) return;
      await browser.tabs.sendMessage(tabId, { type: SHOW_ANNOTATION_MESSAGE, body });
    } catch (err) {
      console.error('[web-anno] failed to fetch annotation', err);
    }
  });
});
