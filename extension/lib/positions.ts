// Reads and writes a sticky note's on-page position and size, persisted
// per (annotation, user) in the `positions` collection (see
// AnnotationBoard.tsx).
//
// x/y are stored as ratios of the window's inner width/height rather
// than raw pixels, since window size varies across devices (and across
// resizes of the same window); width/height are stored as raw pixels,
// since sticky notes have a fixed min-size regardless of window size.
//
// Positions used to also be partitioned per-screen (screen.width/height
// as an extra key), so a dual-monitor setup wouldn't fight over one
// stored position. That partition was removed: browser zoom changes the
// apparent screen size, so zooming fragmented a single note's saved
// layout into multiple records instead of just resizing it in place.
// Since x/y are already stored as window-relative ratios (resolution-
// independent), the per-screen key added no correctness benefit -- only
// this bug. The tradeoff is that multi-monitor users now share one
// layout across displays instead of a separate one per screen.
//
// This module is called from the background script, not the content
// script (see lib/messages.ts), so it has no access to the content
// page's own `window` -- reading that global here would describe the
// background page instead, which is what broke restoring x/y before
// this was fixed. Callers must pass the content page's viewport
// dimensions in explicitly via ViewportInfo.

import { ClientResponseError } from "pocketbase";

import { getAuthedPb } from "./pb";

// The content page's viewport size, captured by content.ts (which has
// the real `window`) and passed through the background-script message
// (see lib/messages.ts).
export interface ViewportInfo {
  windowWidth: number;
  windowHeight: number;
}

// "viewport": the note follows the screen (position: fixed), the
// default for every note. "page": the note stays anchored to a fixed
// spot on the page itself (position: absolute), so it scrolls with the
// page -- e.g. pinning a note near the bottom of a long article.
export type PositionMode = "viewport" | "page";

interface PositionRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  mode: PositionMode;
}

export interface PositionData {
  top: number;
  left: number;
  width: number;
  height: number;
  z: number;
  mode: PositionMode;
}

export interface StoredPosition extends PositionData {
  id: string;
}

function toRatio(pos: PositionData, viewport: ViewportInfo) {
  if (pos.mode === "page") {
    // Page-anchored notes store raw document-relative pixels instead
    // of a window ratio: their whole point is to stay put regardless
    // of viewport size, so ratio-of-window math doesn't apply here.
    return {
      x: pos.left,
      y: pos.top,
      width: pos.width,
      height: pos.height,
      z: pos.z,
      mode: pos.mode,
    };
  }
  return {
    x: pos.left / viewport.windowWidth,
    y: pos.top / viewport.windowHeight,
    width: pos.width,
    height: pos.height,
    // z is a stacking order, not a screen coordinate, so it's stored
    // and restored as-is rather than as a window-relative ratio.
    z: pos.z,
    mode: pos.mode,
  };
}

// Converts a stored ratio back into pixel coordinates for the content
// page's window, clamping so the note can't be restored off-screen --
// e.g. after shrinking the window, or loading on a smaller device.
// Page-mode records skip both the ratio conversion and the clamp,
// since their x/y are already raw document pixels and aren't tied to
// the current viewport size at all.
function fromRatio(
  record: PositionRecord,
  viewport: ViewportInfo,
): PositionData {
  // Defaults to "viewport" for records saved before the mode field
  // existed, rather than treating them as malformed.
  const mode: PositionMode = record.mode ?? "viewport";
  if (mode === "page") {
    return {
      left: record.x,
      top: record.y,
      width: record.width,
      height: record.height,
      z: record.z,
      mode,
    };
  }
  const left = record.x * viewport.windowWidth;
  const top = record.y * viewport.windowHeight;
  return {
    left: Math.min(
      Math.max(left, 0),
      Math.max(viewport.windowWidth - record.width, 0),
    ),
    top: Math.min(
      Math.max(top, 0),
      Math.max(viewport.windowHeight - record.height, 0),
    ),
    width: record.width,
    height: record.height,
    z: record.z,
    mode,
  };
}

// Fetches this user+display's saved position for an annotation, if any.
export async function fetchPosition(
  annotationId: string,
  viewport: ViewportInfo,
): Promise<StoredPosition | undefined> {
  const pb = await getAuthedPb();
  const userId = pb.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated.");

  try {
    const record = await pb
      .collection("positions")
      .getFirstListItem<PositionRecord>(
        pb.filter("annotation = {:annotation} && user = {:user}", {
          annotation: annotationId,
          user: userId,
        }),
      );
    return { id: record.id, ...fromRatio(record, viewport) };
  } catch (err) {
    // getFirstListItem throws a 404 when no record matches; no saved
    // position yet is a normal case, not an error.
    if (err instanceof ClientResponseError && err.status === 404)
      return undefined;
    throw err;
  }
}

// Saves this user+display's position/size for an annotation. Pass the
// id returned by a previous fetchPosition/savePosition call to update
// that record instead of creating a new one.
export async function savePosition(
  annotationId: string,
  pos: PositionData,
  viewport: ViewportInfo,
  existingId?: string,
): Promise<string> {
  const pb = await getAuthedPb();
  const userId = pb.authStore.record?.id;
  if (!userId) throw new Error("Not authenticated.");
  const data = {
    annotation: annotationId,
    user: userId,
    ...toRatio(pos, viewport),
  };

  if (existingId) {
    await pb.collection("positions").update(existingId, data);
    return existingId;
  }

  const created = await pb.collection("positions").create<PositionRecord>(data);
  return created.id;
}
