import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-solid'],
  // "storage" permission is required to persist settings via
  // browser.storage.local (see entrypoints/popup/App.tsx).
  manifest: {
    permissions: ['storage'],
  },
});
