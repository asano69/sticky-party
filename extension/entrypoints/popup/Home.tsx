import { createSignal, onMount } from "solid-js";
import { TextField } from "@kobalte/core/text-field";

import { getAuthedPb } from "../../lib/pb";
import { getDraftNote, saveDraftNote } from "../../lib/draft";
import { continueListOnEnter } from "../../lib/listContinuation";
import { linkAttachment, uploadAttachment } from "../../lib/attachments";
import {
  CHECK_ANNOTATION_MESSAGE,
  type CheckAnnotationMessage,
} from "../../lib/messages";
import {
  addCachedTarget,
  isValidHttpUrl,
  normalizeTarget,
} from "../../lib/targets";
import type { NoteColor } from "../../lib/colors";
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
export default function Home(props: {
  onAnnotationCreated?: () => void;
  // Color for the note being created. Owned by the parent (App.tsx)
  // and set via NavBar's color picker, since it also drives the
  // popup's overall background -- see App.tsx/lib/popupColor.ts.
  color: NoteColor;
}) {
  const [url, setUrl] = createSignal("");
  const [note, setNote] = createSignal("");
  const [error, setError] = createSignal("");
  const [status, setStatus] = createSignal<SaveStatus>("idle");
  // Ids of attachments uploaded while composing this note, before the
  // annotation itself exists yet (see lib/attachments.ts). Linked to
  // the real annotation once handleSave actually creates it; cleared
  // after saving, same as the note body itself.
 const [pendingAttachmentIds, setPendingAttachmentIds] =
  createSignal<string[]>([]);
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

  // Auto-continues bullet/task syntax when plain Enter is pressed in
  // the note textarea (see lib/listContinuation.ts) -- same behavior as
  // the annotation-iframe's edit textarea (NoteContent.tsx), so a note
  // typed at creation time and one edited later behave identically.
  // Ctrl/Cmd+Enter is left alone here so it still bubbles up to
  // onFormKeyDown's submit handler above.
  const onNoteKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.ctrlKey || e.metaKey) return;
    if (!(e.target instanceof HTMLTextAreaElement)) return;
    const next = continueListOnEnter(e, e.target);
    if (next !== undefined) updateNote(next);
  };

  // Uploads a pasted clipboard image and inserts its embed syntax at
  // the cursor, mirroring annotation-iframe/NoteContent.tsx's
  // handlePasteImage. No preview here (unlike the iframe editor) --
  // just the placeholder text -- since the popup is a small, one-shot
  // compose form rather than something people leave open. The
  // annotation doesn't exist yet at this point, so the upload has no
  // annotationId; the attachment is linked once handleSave actually
  // creates the annotation (see lib/attachments.ts's linkAttachment).
  const onNotePaste = async (e: ClipboardEvent) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) =>
      i.type.startsWith("image/"),
    );
    if (!item) return; // No image on the clipboard -- let normal text paste proceed.
    const blob = item.getAsFile();
    if (!blob || !(e.target instanceof HTMLTextAreaElement)) return;

    e.preventDefault();
    const textarea = e.target;
    try {
      const attachmentId = await uploadAttachment(blob);
      setPendingAttachmentIds((ids) => [...ids, attachmentId]);
      const { selectionStart, selectionEnd, value } = textarea;
      const insertion = `![[${attachmentId}]]`;
      const next =
        value.slice(0, selectionStart) + insertion + value.slice(selectionEnd);
      const cursor = selectionStart + insertion.length;

      // No input event fires for a prevented paste, so the textarea's
      // own value/caret must be updated by hand, same as
      // continueListOnEnter above.
      textarea.value = next;
      textarea.selectionStart = textarea.selectionEnd = cursor;
      updateNote(next);
    } catch (err) {
      console.error("[sticky-party] failed to upload pasted image", err);
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
        color: props.color,
      });
      await addCachedTarget(target, created.updated);
      // Link any images pasted before the annotation existed (see
      // onNotePaste above) to the now-saved annotation. Best-effort: a
      // failure here just leaves that attachment permanently unlinked
      // (same accepted tradeoff as an unsaved/cancelled edit -- see
      // lib/attachments.ts), so it doesn't block the rest of save.
      for (const attachmentId of pendingAttachmentIds()) {
        try {
          await linkAttachment(attachmentId, created.id);
        } catch (err) {
          console.error("[sticky-party] failed to link attachment", err);
        }
      }
      setPendingAttachmentIds([]);
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
          onKeyDown={onNoteKeyDown}
          onPaste={onNotePaste}
        />
      </TextField>

      <div class="flex justify-center">
        <SaveButton status={status()} />
      </div>
      {error() && <p class={SAVED_HINT}>{error()}</p>}
    </form>
  );
}
