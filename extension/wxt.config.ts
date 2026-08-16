import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  // "storage" permission is required to persist settings via
  // browser.storage.local (see entrypoints/popup/App.tsx) and the cached
  // target list (see lib/targets.ts).
  // "activeTab" permission lets the popup read the current tab's URL
  // (see entrypoints/popup/Home.tsx) without requesting broad host access.
  // "tabs" lets the background script read every tab's URL as it
  // navigates, so it can match against the cached target list (see
  // entrypoints/background.ts).
  // "alarms" wakes the MV3 service worker on a schedule for periodic
  // full sync even after it has been killed for inactivity.
  manifest: {
    permissions: ['storage', 'activeTab', 'tabs', 'alarms'],
  },
});
