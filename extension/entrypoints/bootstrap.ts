// Tiny content script, statically declared in the manifest (unlike
// entrypoints/content/index.ts, which uses registration: "runtime" and
// is only ever injected imperatively -- see below). It runs on every
// page, but does nothing beyond a single message send, so its cost is
// negligible even on the vast majority of pages that have no annotation.
//
// Its only job is to tell background.ts this page loaded. background.ts
// (see checkTab/runCheckTab in entrypoints/background.ts) does the
// actual cached-target lookup, and only when it matches does it inject
// the real content script into this tab via browser.scripting.executeScript.
// Keeping that heavier script out of the manifest's static content_scripts
// means it never runs its note-mounting logic on a page with nothing to
// show.
import {
  CHECK_ANNOTATION_MESSAGE,
  type CheckAnnotationMessage,
} from "../lib/messages";

export default defineContentScript({
  matches: ["*://*/*"],
  main() {
    browser.runtime.sendMessage({
      type: CHECK_ANNOTATION_MESSAGE,
      url: location.href,
    } satisfies CheckAnnotationMessage);
  },
});
