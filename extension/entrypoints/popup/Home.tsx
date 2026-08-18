import { createSignal, onMount } from "solid-js";
import { TextField } from "@kobalte/core/text-field";

import { getAuthedPb } from "../../lib/pb";
import { getDraftNote, saveDraftNote } from "../../lib/draft";
import {
  CHECK_ANNOTATION_MESSAGE,
  type CheckAnnotationMessage,
} from "../../lib/messages";
import { addCachedTarget, isValidHttpUrl, normalizeTarget } from "../../lib/targets";
import {
  CARD,
  FIELD,
  FIELD_INPUT,
  FIELD_LABEL,
  FIELD_TEXTAREA,
  SAVED_HINT,
} from "./classes";
import SaveButton, { type SaveStatus } from "./SaveButton";

// Form for creating a new annotation on the current page. Saving writes
// the annotation to PocketBase, then mirrors its target into the local
// cache the content script matches against (write-through; see
// docs/architecture.md). Position data (x/y/width/height) is not
// collected here -- that belongs to the future drag-placement flow.
export default function Home(props: { onAnnotationCreated?: () => void }) {
  const [url, setUrl] = createSignal("");
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal<SaveStatus>("idle");
  // Needed after save to ask the background script to re-check this tab
  // (see handleSave below); captured once here since the popup has no
  // sender.tab context of its own to fall back on.
  const [tabId, setTabId] = createSignal<number>();

  onMount(async () => {
    // Prefill with the active tab's URL so the common case (annotating
    // the page you're currently on) needs no typing. Still editable in
    // case the user wants to annotate a different URL.
    const [activeTab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (activeTab?.url) {
      setUrl(activeTab.url);
    }
    setTabId(activeTab?.id);

    // Restore any note body left unsaved from a previous time the
    // popup was closed (see lib/draft.ts).
    setNote(await getDraftNote());
  });

  // Keeps the note body and its draft copy in sync on every keystroke,
  // so closing the popup mid-edit doesn't lose the text.
  const updateNote = (value: string) => {
    setNote(value);
    saveDraftNote(value);
  };

  // Lets Ctrl/Cmd+Enter submit from any field, without needing to tab to
  // the Save button first (mirrors AnnotationBoard.tsx's editor shortcut).
  const onFormKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave(e);
    }
  };

  const handleSave = async (e: Event) => {
    e.preventDefault();
    setError("");

    // Reject anything that isn't a well-formed http(s) URL before
    // touching the network, so an obviously bad value never reaches
    // the DB or the local target cache.
    if (!isValidHttpUrl(url())) {
      setError("Enter a valid http:// or https:// URL.");
      setStatus("error");
      return;
    }

    setStatus("saving");
    try {
      const pb = await getAuthedPb();
      // Normalize once so the value written to the DB and the value
      // mirrored into the local cache (write-through) are identical.
      const target = normalizeTarget(url());
      const created = await pb.collection("annotations").create({
        target,
        body: note(),
      });
      await addCachedTarget(target, created.updated);
      // The note was saved to the DB, so the local draft is no longer
      // needed.
      await saveDraftNote("");
      // Re-run content.ts's mount process for the current tab so the
      // annotation just saved shows up immediately, instead of waiting
      // for the next navigation or periodic full sync.
      if (tabId() != null) {
        browser.runtime.sendMessage({
          type: CHECK_ANNOTATION_MESSAGE,
          url: target,
          tabId: tabId(),
        } satisfies CheckAnnotationMessage);
      }
      // Lets App.tsx refresh the displayed annotation count (see
      // App.tsx's handleAnnotationCreated) now that one more annotation
      // exists.
      props.onAnnotationCreated?.();
      setNote("");
      setStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
      setStatus("error");
    }
  };

  return (
    <form class={CARD} onSubmit={handleSave} onKeyDown={onFormKeyDown}>
      <TextField class={FIELD} value={url()} onChange={setUrl}>
        <TextField.Label class={FIELD_LABEL}>URL</TextField.Label>
        <TextField.Input
          class={FIELD_INPUT}
          type="url"
          placeholder="https://example.com"
        />
      </TextField>

      <TextField class={FIELD} value={note()} onChange={updateNote}>
        <TextField.Label class={FIELD_LABEL}>Note</TextField.Label>
        <TextField.TextArea
          class={FIELD_TEXTAREA}
          rows={4}
          placeholder="Write a note for this page…"
        />
      </TextField>

      <div class="flex justify-center">
        <SaveButton status={status()} />
      </div>
      {error() && <p class={SAVED_HINT}>{error()}</p>}
    </form>
  );
}
