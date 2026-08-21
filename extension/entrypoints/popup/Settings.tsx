import { createSignal, onMount } from "solid-js";
import { TextField } from "@kobalte/core/text-field";

import {
  getSettings,
  saveSettings,
  type StoredSettings,
} from "../../lib/settings";
import { fullSyncTargets } from "../../lib/targets";
import { clearSyncErrorBadge, showSyncErrorBadge } from "../../lib/syncBadge";
import { logout } from "../../lib/session";
import { CARD, FIELD, FIELD_INPUT, FIELD_LABEL, SAVED_HINT } from "./classes";
import SaveButton, { type SaveStatus } from "./SaveButton";

export default function Settings(props: { onSaved?: () => void }) {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [backendUrl, setBackendUrl] = createSignal("");
  // Result of the connection check that follows a save, used to drive
  // SaveButton's spin/color states.
  const [status, setStatus] = createSignal<SaveStatus>("idle");
  // Only populated on failure, shown below the button so the person
  // knows why the icon turned red.
  const [error, setError] = createSignal("");
  // The settings last loaded/saved, kept outside the signals above so
  // handleSave can tell whether this save is actually switching
  // backend/account -- see its logout() call below. A plain variable
  // is enough since the UI never reads it directly.
  let savedSettings: StoredSettings | undefined;

  onMount(async () => {
    const settings = await getSettings();
    // Tracks the actually-stored settings regardless of dev prefill
    // below, so handleSave's switchingProfile diff (and its logout()
    // call) is always based on what's really saved, never on the
    // literal text sitting in the form.
    savedSettings = settings;

    if (settings) {
      // Real saved settings always win, dev or not -- once someone
      // (including a previous dev session) has actually saved an
      // account, the form should reflect that, not silently swap it
      // out for the dev default underneath them.
      setEmail(settings.email);
      setPassword(settings.password);
      setBackendUrl(settings.backendUrl);
    } else if (import.meta.env.DEV) {
      // Dev convenience only: when nothing is saved yet, prefill the
      // form with these literals when running the dev server -- makes
      // it trivial to try the default local account without typing it
      // out. Nothing here is persisted or enforced; pressing Save
      // still saves whatever the fields currently contain, exactly
      // like any other edit.
      setEmail("admin@mail.dev");
      setPassword("password");
      setBackendUrl("http://localhost:3000");
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
      const next: StoredSettings = {
        email: email(),
        password: password(),
        backendUrl: backendUrl(),
      };
      // Switching to a different backend/account: log out of the
      // previous one first, so its cached data (auth token, target
      // list, popup color, etc.) never leaks into the new session --
      // see lib/session.ts. A no-op save (nothing actually changed) or
      // the very first save (no prior settings) skips this.
      const switchingProfile =
        savedSettings !== undefined &&
        (savedSettings.email !== next.email ||
          savedSettings.password !== next.password ||
          savedSettings.backendUrl !== next.backendUrl);
      if (switchingProfile) await logout();

      await saveSettings(next);
      // Pull the full target list rather than just authenticating: it
      // still proves the connection works (it authenticates internally,
      // see lib/pb.ts), but also refreshes the local cache immediately,
      // so Settings doubles as a manual "connect + sync" action instead
      // of a bare connection check.
      await fullSyncTargets();
      clearSyncErrorBadge();
      savedSettings = next;
      setStatus("success");
      // Lets App.tsx re-check whether credentials are now saved, so
      // Home/Targets unlock immediately instead of staying locked
      // until the popup is reopened (see App.tsx's checkConfigured).
      props.onSaved?.();
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Failed to connect.");
      showSyncErrorBadge();
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
