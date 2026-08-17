import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  // Tailwind v4 needs no PostCSS setup, just its own Vite plugin (same
  // pattern as frontend/vite.config.js). Each bundle (popup,
  // annotation-iframe) pulls it in via `@import "tailwindcss";` in its
  // own style.css; content.ts renders no CSS of its own, so it needs no
  // import here.
  vite: () => ({
    plugins: [tailwindcss()],
  }),
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
    // Required by Firefox for MV3 add-ons: a stable id so updates are
    // recognized as the same extension, plus a declaration of what user
    // data (if any) is collected. This extension collects nothing itself
    // (annotation data goes straight to the user's own PocketBase
    // backend), hence "none".
    browser_specific_settings: {
      gecko: {
        id: 'sticky-party@asano69.dev',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
});
