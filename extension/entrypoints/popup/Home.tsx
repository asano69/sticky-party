import { createSignal, onMount } from 'solid-js';
import { TextField } from '@kobalte/core/text-field';
import { Button } from '@kobalte/core/button';
import CircleCheckBig from 'lucide-solid/icons/circle-check-big';

import { getAuthedPb } from '../../lib/pb';
import { CHECK_ANNOTATION_MESSAGE, type CheckAnnotationMessage } from '../../lib/messages';
import { addCachedTarget, normalizeTarget } from '../../lib/targets';

// Form for creating a new annotation on the current page. Saving writes
// the annotation to PocketBase, then mirrors its target into the local
// cache the content script matches against (write-through; see
// docs/architecture.md). Position data (x/y/width/height) is not
// collected here -- that belongs to the future drag-placement flow.
export default function Home() {
  const [url, setUrl] = createSignal('');
  const [note, setNote] = createSignal('');
  const [error, setError] = createSignal('');
  const [saving, setSaving] = createSignal(false);
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
  });

  const handleSave = async (e: Event) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const pb = await getAuthedPb();
      // Normalize once so the value written to the DB and the value
      // mirrored into the local cache (write-through) are identical.
      const target = normalizeTarget(url());
      await pb.collection('annotations').create({
        target,
        body: note(),
      });
      await addCachedTarget(target);
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
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form class="card" onSubmit={handleSave}>
      <TextField class="field" value={url()} onChange={setUrl}>
        <TextField.Label class="field-label">URL</TextField.Label>
        <TextField.Input
          class="field-input"
          type="url"
          placeholder="https://example.com"
        />
      </TextField>

      <TextField class="field" value={note()} onChange={setNote}>
        <TextField.Label class="field-label">Note</TextField.Label>
        <TextField.TextArea
          class="field-input field-textarea"
          rows={4}
          placeholder="Write a note for this page…"
        />
      </TextField>

      {error() && <p class="saved-hint">{error()}</p>}

      <div style={{ display: 'flex', 'justify-content': 'center' }}>
        <Button type="submit" class="icon-btn" disabled={saving()} aria-label="Save">
          <CircleCheckBig size={20} class={saving() ? 'spin' : ''} />
        </Button>
      </div>
    </form>
  );
}
