import PocketBase from "pocketbase";

import { getSettings } from "./settings";

// Returns a PocketBase client authenticated as the app superuser, using
// the credentials from Settings. This app is single-user (see
// frontend/src/routes/Login.jsx), so the same _superusers account backs
// both the web UI and the extension.
//
// Re-authenticating on every call keeps this simple: the popup is
// short-lived, so there is no long-running session worth caching.
export async function getAuthedPb(): Promise<PocketBase> {
  const settings = await getSettings();
  if (!settings?.backendUrl || !settings.username || !settings.password) {
    throw new Error(
      "Set backend URL, username and password in Settings first.",
    );
  }

  const pb = new PocketBase(settings.backendUrl);
  await pb
    .collection("_superusers")
    .authWithPassword(settings.username, settings.password);
  return pb;
}
