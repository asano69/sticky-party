import { createSignal, onMount } from 'solid-js';
import { TextField } from '@kobalte/core/text-field';
import { Button } from '@kobalte/core/button';
import './App.css';

// All persisted settings live under a single storage key. fingerprint
// identifies this device/install and is generated once; it is never
// shown or edited in the UI.
const STORAGE_KEY = 'settings';

interface StoredSettings {
  username: string;
  password: string;
  backendUrl: string;
  fingerprint: string;
}

async function loadSettings(): Promise<StoredSettings | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] as StoredSettings | undefined;
}

function App() {
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [backendUrl, setBackendUrl] = createSignal('');
  const [saved, setSaved] = createSignal(false);

  onMount(async () => {
    const settings = await loadSettings();

    if (settings) {
      setUsername(settings.username);
      setPassword(settings.password);
      setBackendUrl(settings.backendUrl);
    }

    // Ensure a fingerprint exists as soon as the popup is opened, even if
    // the user never touches the form.
    if (!settings?.fingerprint) {
      await browser.storage.local.set({
        [STORAGE_KEY]: { ...settings, fingerprint: crypto.randomUUID() },
      });
    }
  });

  const handleSave = async (e: Event) => {
    e.preventDefault();

    const existing = await loadSettings();
    const fingerprint = existing?.fingerprint ?? crypto.randomUUID();

    await browser.storage.local.set({
      [STORAGE_KEY]: {
        username: username(),
        password: password(),
        backendUrl: backendUrl(),
        fingerprint,
      } satisfies StoredSettings,
    });

    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <form class="card" onSubmit={handleSave}>
      <h1>web-anno</h1>

      <TextField class="field" value={username()} onChange={setUsername}>
        <TextField.Label class="field-label">Username</TextField.Label>
        <TextField.Input class="field-input" />
      </TextField>

      <TextField class="field" value={password()} onChange={setPassword}>
        <TextField.Label class="field-label">Password</TextField.Label>
        <TextField.Input class="field-input" type="password" />
      </TextField>

      <TextField class="field" value={backendUrl()} onChange={setBackendUrl}>
        <TextField.Label class="field-label">Backend URL</TextField.Label>
        <TextField.Input
          class="field-input"
          type="url"
          placeholder="https://example.com"
        />
      </TextField>

      <Button type="submit" class="btn">
        Save
      </Button>
      {saved() && <p class="saved-hint">Saved.</p>}
    </form>
  );
}

export default App;
