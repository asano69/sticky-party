import PocketBase, { AsyncAuthStore, ClientResponseError } from "pocketbase";

import { getSettings } from "./settings";

// Key under which the serialized auth token (+ user record) is kept in
// browser.storage.local. Shared by every context (popup, background,
// every annotation-iframe), so a token refreshed in one place is
// immediately usable everywhere else -- see the AsyncAuthStore below.
const AUTH_STORAGE_KEY = "pb_auth";

// Backs PocketBase's authStore with browser.storage.local instead of the
// default localStorage: a browser extension has no single shared
// localStorage across popup/background/content-script/iframe contexts,
// but browser.storage.local is one storage area all of them can read
// and write. The stored value is only ever readable from this
// extension's own contexts -- a host page's JS cannot reach it, unlike
// plain localStorage on that page.
//
// `initial` is read up front (not passed as a pending Promise) so
// authStore.isValid is correct immediately after construction, with no
// risk of checking it before the stored value has loaded.
async function createAuthStore(): Promise<AsyncAuthStore> {
  const stored = await browser.storage.local.get(AUTH_STORAGE_KEY);
  return new AsyncAuthStore({
    save: async (serialized) =>
      browser.storage.local.set({ [AUTH_STORAGE_KEY]: serialized }),
    clear: async () => browser.storage.local.remove(AUTH_STORAGE_KEY),
    initial: stored[AUTH_STORAGE_KEY] as string | undefined,
  });
}

// Returns a PocketBase client authenticated as a regular `users` record
// (not a superuser). Annotations are shared across all users, so this
// login only gates write access to the backend; it does not scope which
// annotations a user can see.
//
// The client itself is cheap to create every time this is called --
// authWithPassword (the expensive part) only runs when no still-valid
// token is already in browser.storage.local. This makes it fine to call
// getAuthedPb() per-operation (popup, background.ts) as well as once and
// reuse the result for a whole component's lifetime (annotation-iframe,
// see useAuthedPb.ts).
export async function getAuthedPb(): Promise<PocketBase> {
  const settings = await getSettings();
  if (!settings?.backendUrl || !settings.email || !settings.password) {
    throw new Error("Set backend URL, email and password in Settings first.");
  }

  const pb = new PocketBase(settings.backendUrl, await createAuthStore());
  if (!pb.authStore.isValid) {
    await pb
      .collection("users")
      .authWithPassword(settings.email, settings.password);
  }
  return pb;
}

// Runs `fn` and, if it fails because the stored token expired (401),
// re-authenticates once and retries -- so callers never have to think
// about the token's expiry (see the `users` collection's
// authToken.duration) themselves. Re-authenticating updates the shared
// browser.storage.local token too, so every other context benefits from
// this one retry.
export async function withReauth<T>(
  pb: PocketBase,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!(err instanceof ClientResponseError) || err.status !== 401) throw err;

    const settings = await getSettings();
    if (!settings) throw err;
    await pb
      .collection("users")
      .authWithPassword(settings.email, settings.password);
    return await fn();
  }
}
