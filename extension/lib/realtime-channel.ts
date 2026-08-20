// Target-scoped BroadcastChannel name for realtime annotation updates.
// Both the realtime-orchestrator iframe and every NoteContent iframe
// for the same page share this channel to exchange "update" events
// directly -- they're same-origin extension pages, so no relay through
// content.ts is needed (unlike create/delete, which need content.ts to
// mount/unmount a wrapper element -- see lib/realtime-messages.ts).
//
// Scoped per target (not one global channel) so a person with multiple
// unrelated sites open doesn't have every tab's orchestrator broadcast
// to every tab's notes.
export function realtimeChannelName(target: string): string {
  return `sticky-party:realtime:${target}`;
}
