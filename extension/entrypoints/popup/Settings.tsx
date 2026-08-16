import { createSignal, onMount } from 'solid-js';
import { TextField } from '@kobalte/core/text-field';
import { Button } from '@kobalte/core/button';
import CircleCheckBig from 'lucide-solid/icons/circle-check-big';

import { getSettings, saveSettings, ensureFingerprint } from '../../lib/settings';
import { CARD, FIELD, FIELD_INPUT, FIELD_LABEL, ICON_BTN, SAVED_HINT } from './classes';

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

  // Lets Ctrl/Cmd+Enter submit from any field, without needing to tab to
  // the Save button first (mirrors AnnotationBoard.tsx's editor shortcut).
  const onFormKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSave(e);
    }
  };

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
    <form class={CARD} onSubmit={handleSave} onKeyDown={onFormKeyDown}>
      <TextField class={FIELD} value={email()} onChange={setEmail}>
        <TextField.Label class={FIELD_LABEL}>Email</TextField.Label>
        <TextField.Input class={FIELD_INPUT} type="email" />
      </TextField>

      <TextField class={FIELD} value={password()} onChange={setPassword}>
        <TextField.Label class={FIELD_LABEL}>Password</TextField.Label>
        <TextField.Input class={FIELD_INPUT} type="password" />
      </TextField>

      <TextField class={FIELD} value={backendUrl()} onChange={setBackendUrl}>
        <TextField.Label class={FIELD_LABEL}>Backend URL</TextField.Label>
        <TextField.Input class={FIELD_INPUT} type="url" placeholder="https://example.com" />
      </TextField>

      <div class="flex justify-center">
        <Button type="submit" class={ICON_BTN} aria-label="Save">
          <CircleCheckBig size={20} />
        </Button>
      </div>
      {saved() && <p class={SAVED_HINT}>Saved.</p>}
    </form>
  );
}
