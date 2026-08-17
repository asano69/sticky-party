import { createSignal, onMount } from 'solid-js';
import { TextField } from '@kobalte/core/text-field';
import { Button } from '@kobalte/core/button';
import CircleCheckBig from 'lucide-solid/icons/circle-check-big';

import { getSettings, saveSettings, ensureFingerprint } from '../../lib/settings';
import { getAuthedPb } from '../../lib/pb';
import { CARD, FIELD, FIELD_INPUT, FIELD_LABEL, ICON_BTN } from './classes';

export default function Settings() {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [backendUrl, setBackendUrl] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  // Result of the connection check that follows a save, used to color
  // the button icon (green/red) instead of showing a text hint.
  const [status, setStatus] = createSignal<'idle' | 'success' | 'error'>('idle');
  // Only populated on failure, shown below the button so the person
  // knows why the icon turned red.
  const [error, setError] = createSignal('');

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

    setSaving(true);
    setStatus('idle');
    setError('');
    try {
      await saveSettings({
        email: email(),
        password: password(),
        backendUrl: backendUrl(),
      });
      // Actually authenticate with the entered credentials/URL, so the
      // icon reflects whether the connection really works, not just
      // that the values were saved locally.
      await getAuthedPb();
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to connect.');
    } finally {
      setSaving(false);
    }
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
        <Button type="submit" class={ICON_BTN} disabled={saving()} aria-label="Save">
          <CircleCheckBig
            size={20}
            class={
              saving()
                ? 'animate-spin'
                : status() === 'success'
                  ? 'text-green-600'
                  : status() === 'error'
                    ? 'text-red-600'
                    : ''
            }
          />
        </Button>
      </div>
      {status() === 'error' && <p class="m-0 text-[0.8em] text-red-600">{error()}</p>}
    </form>
  );
}
