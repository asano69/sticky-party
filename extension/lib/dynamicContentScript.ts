// Keeps the sticky-party content script's registered match patterns in
// sync with the local target cache (see lib/targets.ts). The content
// script's entrypoint (entrypoints/content/index.ts) is declared with
// registration: "runtime", so it is never injected via the manifest's
// static content_scripts -- this module is what actually decides which
// pages it runs on, via the runtime scripting API.
//
// This intentionally does NOT narrow which pages actually show a note:
// background.ts's isTargetMatch (exact match on the normalized URL,
// see lib/targets.ts) is still the sole authority on that, unaffected
// by anything here. Match patterns can't express a query string and
// only support path-level wildcards, so the patterns built here are
// necessarily a bit broader than an exact target -- e.g. they also
// match other query strings on the same path. That's fine: a broader
// pattern only means the content script gets injected (and immediately
// no-ops via isTargetMatch) on a few more URLs than strictly necessary,
// never that a note appears somewhere it shouldn't.
//
// registerContentScripts/updateContentScripts require host permission
// for every pattern passed in. entrypoints/content/index.ts's
// registration: "runtime" keeps "*://*/*" declared as a host
// permission (unchanged from before this feature), so any pattern
// derived from a target here is always already covered.

const CONTENT_SCRIPT_ID = "sticky-party-content";

// Output path WXT builds entrypoints/content/index.ts to. Verify this
// against the actual `wxt build` output (content-scripts/ in the
// bundle) after building -- WXT names a directory-based content script
// entrypoint after its folder, but this hasn't been confirmed against
// a real build in this change.
const CONTENT_SCRIPT_JS = ["content-scripts/content.js"];

// Converts a single cached target into a match pattern: scheme + host +
// path, with no query string (match patterns can't express one) and no
// trailing wildcard (an exact path is enough -- see the header comment
// on why a bit of extra breadth here is harmless). Returns undefined
// for a target that somehow isn't a valid URL, so callers can filter
// it out instead of registering a broken pattern.
function toMatchPattern(target: string): string | undefined {
  try {
    const url = new URL(target);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return undefined;
  }
}

// Registers, updates, or (if the cache is now empty) unregisters the
// content script so its match patterns always mirror `targets`. Reads
// the current registration state fresh on every call rather than
// caching a "registered" flag in module memory -- this runs from
// multiple independent JS contexts (popup, background), so an
// in-memory flag in one would never reflect what another already did.
export async function syncContentScriptMatches(
  targets: { target: string }[],
): Promise<void> {
  const matches = [
    ...new Set(
      targets
        .map((t) => toMatchPattern(t.target))
        .filter((pattern): pattern is string => pattern !== undefined),
    ),
  ];

  try {
    const existing = await browser.scripting.getRegisteredContentScripts({
      ids: [CONTENT_SCRIPT_ID],
    });

    if (matches.length === 0) {
      // registerContentScripts/updateContentScripts both reject an
      // empty matches array, so an empty cache is expressed as no
      // registration at all rather than a pattern that can never match.
      if (existing.length > 0) {
        await browser.scripting.unregisterContentScripts({
          ids: [CONTENT_SCRIPT_ID],
        });
      }
      return;
    }

    if (existing.length === 0) {
      await browser.scripting.registerContentScripts([
        {
          id: CONTENT_SCRIPT_ID,
          js: CONTENT_SCRIPT_JS,
          matches,
          runAt: "document_idle",
        },
      ]);
    } else {
      await browser.scripting.updateContentScripts([
        { id: CONTENT_SCRIPT_ID, matches },
      ]);
    }
  } catch (err) {
    console.error("[sticky-party] failed to sync content script matches", err);
  }
}
