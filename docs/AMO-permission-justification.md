# AMO Permission Justification

Sticky Party requests two permissions that Firefox's AMO review flags as
sensitive: the `tabs` API permission (required) and the `*://*/*` host
permission (optional). Both are direct consequences of the extension's
core feature — showing sticky notes automatically on any page the user
has annotated, without requiring a click first — rather than anything
that could be trimmed down without changing the product.

## `tabs` permission

The background script needs to know a tab's URL even when the user
hasn't interacted with the extension at all, so it can decide whether
that page has a note to show:

- `browser.tabs.onUpdated` watches every navigation (including SPA
  route changes) and checks the new URL against a locally cached list
  of annotated targets.
- `recheckAllTabs()` — run after the popup opens or a manual sync
  completes — enumerates every open tab via `browser.tabs.query({})`
  so a target that only just appeared in the cache can be picked up on
  tabs that are already open, not just on their next navigation.

`activeTab` alone can't cover this: it only grants access after an
explicit user gesture (e.g. clicking the toolbar icon), whereas the
whole point of this feature is that notes appear automatically on
background tabs the user hasn't touched yet.

## `*://*/*` host permission

This is what lets the extension inject its content script and load its
iframes into arbitrary sites:

- `browser.scripting.executeScript` injects the note-mounting content
  script (`entrypoints/content/index.ts`) into a tab only after
  `tabs.onUpdated` has confirmed a URL match — never unconditionally on
  every page.
- `web_accessible_resources` exposes `annotation-iframe.html` and
  `realtime-orchestrator.html` so a matched page can load them as
  same-origin extension iframes.

Since a user can annotate literally any URL, the set of sites this
needs to run on can't be known ahead of time, so it can't be narrowed
to a fixed list of hosts.

## Alternative considered

Scoping down to `activeTab` + per-site optional permissions (granted
on demand) was considered, but it would change the product's UX: notes
would only ever appear after the user manually invokes the extension
on that specific page, instead of surfacing automatically whenever a
previously-annotated page is opened. That trade-off was rejected
because "notes just appear on pages you've annotated" is the feature,
not an implementation detail.

## Mitigations already in place

- Host permission access is requested as `optional_permissions`, so
  users who don't want it can decline and the extension still installs
  (with reduced functionality).
- The content script is never statically registered — it's injected at
  runtime, only into tabs that already matched a cached target (see
  `docs/architecture.md`'s "content script の動的注入" section) — so
  the vast majority of page loads never run any of this extension's
  code at all.
- All annotation data goes directly to the user's own self-hosted
  PocketBase backend; nothing is collected by or sent to the extension
  authors (see `manifest.json`'s
  `browser_specific_settings.gecko.data_collection_permissions`).