import { createSignal, onMount } from 'solid-js';
import { TextField } from '@kobalte/core/text-field';
import { Button } from '@kobalte/core/button';
import CircleCheckBig from 'lucide-solid/icons/circle-check-big';

import { getSettings, saveSettings, ensureFingerprint } from '../../lib/settings';

export default function Settings() {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [backendUrl, setBackendUrl] = createSignal('');
  const [saved, setSaved] = createSignal(false);

  onMount(async () => {
    const settings = await getSettings();

    if (settings) {
      setEmail(settings.email);
      setPassword(settings.password);
      setBackendUrl(settings.backendUrl);
    }

    // Ensure a fingerprint exists as soon as the popup is opened, even if
    // the user never touches the form.
    await ensureFingerprint();
  });

  const handleSave = async (e: Event) => {
    e.preventDefault();

    await saveSettings({
      email: email(),
      password: password(),
      backendUrl: backendUrl(),
    });

    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <form class="card" onSubmit={handleSave}>
      <TextField class="field" value={email()} onChange={setEmail}>
        <TextField.Label class="field-label">Email</TextField.Label>
        <TextField.Input class="field-input" type="email" />
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

      <div style={{ display: 'flex', 'justify-content': 'center' }}>
        <Button type="submit" class="icon-btn" aria-label="Save">
          <CircleCheckBig size={20} />
        </Button>
      </div>
      {saved() && <p class="saved-hint">Saved.</p>}
    </form>
  );
}
