import PocketBase from "pocketbase";

import { getSettings } from "./settings";

// Returns a PocketBase client authenticated as a regular `users` record
// (not a superuser). Each install is expected to log in as its own user
// account, so collection rules can scope every read/write to
// `user = @request.auth.id` instead of granting blanket superuser access.
//
// Re-authenticating on every call keeps this simple: the popup is
// short-lived, so there is no long-running session worth caching.
export async function getAuthedPb(): Promise<PocketBase> {
  const settings = await getSettings();
  if (!settings?.backendUrl || !settings.email || !settings.password) {
    throw new Error("Set backend URL, email and password in Settings first.");
  }

  const pb = new PocketBase(settings.backendUrl);
  await pb
    .collection("users")
    .authWithPassword(settings.email, settings.password);
  return pb;
}
