import { createSignal, onMount } from "solid-js";
import { TextField } from "@kobalte/core/text-field";

import { getSettings, saveSettings } from "../../lib/settings";
import { getAuthedPb } from "../../lib/pb";
import { CARD, FIELD, FIELD_INPUT, FIELD_LABEL, SAVED_HINT } from "./classes";
import SaveButton, { type SaveStatus } from "./SaveButton";

export default function Settings() {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [backendUrl, setBackendUrl] = createSignal("");
  // Result of the connection check that follows a save, used to drive
  // SaveButton's spin/color states.
  const [status, setStatus] = createSignal<SaveStatus>("idle");
  // Only populated on failure, shown below the button so the person
  // knows why the icon turned red.
  const [error, setError] = createSignal("");

  onMount(async () => {
    const settings = await getSettings();

    if (settings) {
      setEmail(settings.email);
      setPassword(settings.password);
      setBackendUrl(settings.backendUrl);
    }
  });

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

    setStatus("saving");
    setError("");
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
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect.");
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
        <TextField.Input
          class={FIELD_INPUT}
          type="url"
          placeholder="https://example.com"
        />
      </TextField>

      <div class="flex justify-center">
        <SaveButton status={status()} />
      </div>
      {status() === "error" && <p class={SAVED_HINT}>{error()}</p>}
    </form>
  );
}
