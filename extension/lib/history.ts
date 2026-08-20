// Fetches an annotation's edit history (see internal/history's merge
// rule for how consecutive same-user edits get collapsed server-side).
// Read-only: nothing here writes to `histories` -- all writes happen
// in the PocketBase Go hooks, never from the client.

import { getAuthedPb } from "./pb";

export interface HistoryEntry {
  id: string;
  // Which annotation this row belongs to. Not needed by the initial
  // fetchHistory call below (it's already filtered to one annotation),
  // but required when a row instead arrives over the target-scoped
  // realtime channel (see useHistoryUpdates.ts), which can carry rows
  // for any annotation sharing that target.
  annotationId: string;
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
  });
  // userName is snapshotted onto the row at write time (see
  // internal/history), not resolved via a "user" relation -- the
  // "users" collection's viewRule only lets a person see their own
  // record, so expanding "user" here would show every other person as
  // unknown. The fallback only matters for rows written before this
  // field existed.
  return records.map((record) => ({
    id: record.id,
    annotationId: record.annotationId,
    action: record.action,
    updated: record.updated,
    userName: record.userName || "unknown",
  }));
}
