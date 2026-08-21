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
// Whether two match-pattern lists contain the same set of patterns,
// ignoring order. Used to skip re-registering the content script
// entirely when nothing has actually changed -- see the comment in
// syncContentScriptMatches below for why that matters.
function sameMatches(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  return b.every((pattern) => setA.has(pattern));
}

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

    // Every writer of the target cache (popup write-through, full/diff
    // sync, deletion) calls this on every change -- including changes
    // that don't actually touch any target's match pattern (e.g. a
    // popup open re-running a differential sync that finds nothing
    // new). Calling registerContentScripts/updateContentScripts
    // unconditionally in that case re-registers a script that's
    // already registered with the exact same patterns, which both
    // re-injects it into every open tab below (injectIntoOpenTabs) and
    // -- in dev mode -- makes WXT's own tooling reload it, tearing down
    // whatever that tab's content script had already mounted (see the
    // notes/ doc on the disappearing-note bug). Skipping the update
    // entirely when the pattern set is unchanged avoids both.
    if (existing.length > 0 && sameMatches(existing[0].matches ?? [], matches)) {
      return;
    }

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

    // registerContentScripts/updateContentScripts only take effect on
    // future navigations -- a tab already sitting open on a URL that
    // just started matching (e.g. the very first annotation saved for
    // it) never gets the content script injected on its own. Without
    // this, background.ts's CHECK_ANNOTATION_MESSAGE handling has no
    // listener in that tab and browser.tabs.sendMessage fails silently,
    // so the freshly-saved annotation never appears. Injecting into
    // every open tab here is safe even where the script is already
    // running: its own top-level guard (see
    // entrypoints/content/index.ts's __stickyPartyContentLoaded) makes
    // a repeat injection a no-op.
    await injectIntoOpenTabs();
  } catch (err) {
    console.error("[sticky-party] failed to sync content script matches", err);
  }
}

// Executes the content script directly into every currently open tab.
// Restricted pages (chrome://, the extension store, etc.) reject the
// injection -- each attempt is caught individually so one such tab
// can't stop the rest from being covered.
async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab): tab is typeof tab & { id: number } => tab.id != null)
      .map((tab) =>
        browser.scripting
          .executeScript({
            target: { tabId: tab.id },
            files: CONTENT_SCRIPT_JS,
          })
          .catch(() => {}),
      ),
  );
}
