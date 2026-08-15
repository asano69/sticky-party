import { createSignal, onMount } from 'solid-js';
import { TextField } from '@kobalte/core/text-field';
import { Button } from '@kobalte/core/button';

// Form for creating a new annotation on the current page. Saving is not
// wired up yet; this only establishes the layout and fields.
export default function Home() {
  const [url, setUrl] = createSignal('');
  const [note, setNote] = createSignal('');

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

  const handleSave = (e: Event) => {
    e.preventDefault();
    // TODO: persist the annotation via the backend once the API is ready.
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

      <Button type="submit" class="btn">
        Save
      </Button>
    </form>
  );
}
