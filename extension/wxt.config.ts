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
  // "web_accessible_resources" exposes annotation-iframe.html so content
  // scripts can load it in an iframe (see entrypoints/content.ts). The
  // iframe is what actually renders each note's title/body: since it's
  // loaded from the extension's own origin rather than injected into the
  // host page's DOM, the host page cannot read its content.
  manifest: {
    permissions: ['storage', 'activeTab', 'tabs', 'alarms'],
    web_accessible_resources: [
      {
        resources: ['annotation-iframe.html'],
        matches: ['*://*/*'],
      },
    ],
  },
});
