// Shared source of truth for extension settings (backend credentials and
// device fingerprint), persisted under a single browser.storage.local key.
// Settings.tsx (editing) and lib/pb.ts (authenticating) both read through
// this module instead of touching browser.storage directly.

const STORAGE_KEY = "settings";

export interface StoredSettings {
  email: string;
  password: string;
  backendUrl: string;
  fingerprint: string;
}

export async function getSettings(): Promise<StoredSettings | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] as StoredSettings | undefined;
}

export async function saveSettings(
  settings: Omit<StoredSettings, "fingerprint">,
): Promise<void> {
  const existing = await getSettings();
  const fingerprint = existing?.fingerprint ?? crypto.randomUUID();
  await browser.storage.local.set({
    [STORAGE_KEY]: { ...settings, fingerprint } satisfies StoredSettings,
  });
}

// Ensures a fingerprint exists even if the user never opens the Settings
// form. Safe to call repeatedly; it's a no-op once a fingerprint is set.
export async function ensureFingerprint(): Promise<void> {
  const existing = await getSettings();
  if (existing?.fingerprint) return;
  await browser.storage.local.set({
    [STORAGE_KEY]: { ...existing, fingerprint: crypto.randomUUID() },
  });
}
