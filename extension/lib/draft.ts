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
