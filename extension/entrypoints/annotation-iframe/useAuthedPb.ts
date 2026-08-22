// Provides a single, mount-lifetime PocketBase client for the
// annotation-iframe. Unlike lib/pb.ts's getAuthedPb() on its own (used
// per-operation by popup and background.ts, both fine re-creating a
// client every call -- see that file's comment), this iframe stays
// mounted for as long as the note is on screen, so a single client is
// created once here and reused for every operation while the note is
// open, avoiding a fresh auth check per call.

import { createSignal, onMount } from "solid-js";
import type PocketBase from "pocketbase";

import { getAuthedPb } from "../../lib/pb";
import { log } from "../../lib/log";

export function useAuthedPb() {
  const [pb, setPb] = createSignal<PocketBase>();

  onMount(async () => {
    try {
      setPb(await getAuthedPb());
    } catch (err) {
      log.error("failed to authenticate", { err });
    }
  });

  return pb;
}
