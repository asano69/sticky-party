// Temporary storage for an in-progress note draft (Home.tsx), so
// closing the popup before saving doesn't lose what was typed --
// closing the popup unmounts it and discards all local component
// state. Only the note body is kept here; the URL field doesn't need
// this since it's freshly prefilled from the active tab every time the
// popup opens (see Home.tsx's onMount).

const DRAFT_KEY = "draftNote";

export async function getDraftNote(): Promise<string> {
  const result = await browser.storage.local.get(DRAFT_KEY);
  return (result[DRAFT_KEY] as string | undefined) ?? "";
}

export async function saveDraftNote(note: string): Promise<void> {
  await browser.storage.local.set({ [DRAFT_KEY]: note });
}

// Clears any in-progress draft. Used by lib/session.ts's logout(): a
// draft written under the old profile has no meaning once its backend/
// account changes.
export async function clearDraftNote(): Promise<void> {
  await browser.storage.local.remove(DRAFT_KEY);
}
