// Fetches an annotation's edit history (see internal/history's merge
// rule for how consecutive same-user edits get collapsed server-side).
// Read-only: nothing here writes to `histories` -- all writes happen
// in the PocketBase Go hooks, never from the client.

import { getAuthedPb } from "./pb";

export interface HistoryEntry {
  id: string;
  action: "create" | "update" | "delete";
  // The timestamp shown in the UI. This is deliberately `updated`, not
  // `created`: consecutive same-user edits within the merge window
  // (see internal/history's merge rule) rewrite the existing row's
  // `action` in place, which bumps `updated` but leaves `created`
  // fixed at the row's original creation time. Displaying `created`
  // would make a freshly-merged row look stale.
  updated: string;
  userName: string;
}

export async function fetchHistory(
  annotationId: string,
): Promise<HistoryEntry[]> {
  const pb = await getAuthedPb();
  const records = await pb.collection("histories").getFullList({
    filter: pb.filter("annotationId = {:id}", { id: annotationId }),
    // Matches the merge rule's own ordering key (see
    // internal/history), so the list's order agrees with which row a
    // new edit would actually merge into.
    sort: "-updated",
    expand: "user",
  });
  return records.map((record) => ({
    id: record.id,
    action: record.action,
    updated: record.updated,
    // Falls back when the user was deleted (expand comes back empty)
    // or has no name set.
    userName: record.expand?.user?.name || "unknown",
  }));
}
