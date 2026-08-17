// Shared source of truth for extension settings (backend credentials),
// persisted under a single browser.storage.local key. Settings.tsx
// (editing) and lib/pb.ts (authenticating) both read through this
// module instead of touching browser.storage directly.

const STORAGE_KEY = "settings";

export interface StoredSettings {
  email: string;
  password: string;
  backendUrl: string;
}

export async function getSettings(): Promise<StoredSettings | undefined> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] as StoredSettings | undefined;
}

export async function saveSettings(settings: StoredSettings): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: settings });
}
