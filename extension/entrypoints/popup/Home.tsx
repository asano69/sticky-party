import { createSignal, onMount } from 'solid-js';
import { TextField } from '@kobalte/core/text-field';
import { Button } from '@kobalte/core/button';

import { getAuthedPb } from '../../lib/pb';
import { addCachedTarget } from '../../lib/targets';

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
  });

  const handleSave = async (e: Event) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const pb = await getAuthedPb();
      // pb.authStore.record is the just-authenticated `users` record; its
      // id must match the Create rule's `@request.body.user = @request.auth.id`.
      await pb.collection('annotations').create({
        target: url(),
        body: note(),
        user: pb.authStore.record?.id,
      });
      await addCachedTarget(url());
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

      <Button type="submit" class="btn" disabled={saving()}>
        {saving() ? 'Saving…' : 'Save'}
      </Button>
    </form>
  );
}
