// Provides a single, mount-lifetime PocketBase client for the
// annotation-iframe. Unlike lib/pb.ts's getAuthedPb() on its own (used
// per-operation by popup and background.ts, both fine re-creating a
// client every call -- see that file's comment), this iframe stays
// mounted for as long as the note is on screen, and a realtime
// subscription (see NoteContent.tsx) needs one stable client to live on
// for its whole lifetime, not a fresh one per call.

import { createSignal, onCleanup, onMount } from "solid-js";
import type PocketBase from "pocketbase";

import { getAuthedPb } from "../../lib/pb";

export function useAuthedPb() {
  const [pb, setPb] = createSignal<PocketBase>();

  onMount(async () => {
    try {
      setPb(await getAuthedPb());
    } catch (err) {
      console.error("[sticky-party] failed to authenticate", err);
    }
  });

  // Drops any realtime subscriptions this client still holds when the
  // note is removed from the page.
  onCleanup(() => {
    pb()?.realtime.unsubscribe();
  });

  return pb;
}
