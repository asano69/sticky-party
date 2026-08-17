// Reads and writes a sticky note's on-page position and size, persisted
// per (annotation, user, screen) in the `positions` collection so each
// display keeps its own layout (see AnnotationBoard.tsx).
//
// x/y are stored as ratios of the window's inner width/height rather
// than raw pixels, since window size varies across devices (and across
// resizes of the same window); width/height are stored as raw pixels,
// since sticky notes have a fixed min-size regardless of window size.
//
// This module is called from the background script, not the content
// script (see lib/messages.ts), so it has no access to the content
// page's own `window`/`screen` -- reading those globals here would
// describe the background page instead, which is what broke restoring
// x/y before this was fixed. Callers must pass the content page's
// viewport/screen dimensions in explicitly via ViewportInfo.

import { ClientResponseError } from "pocketbase";

import { getAuthedPb } from "./pb";

// The content page's viewport size and display resolution, captured by
// content.ts (which has the real `window`/`screen`) and passed through
// the background-script message (see lib/messages.ts).
export interface ViewportInfo {
  windowWidth: number;
  windowHeight: number;
  screenWidth: number;
  screenHeight: number;
}

// This display's resolution, so a dual-monitor setup keeps a separate
// saved layout per screen instead of two monitors fighting over the
// same stored position (e.g. a laptop docked to an external display
// with a different resolution). Combined with the backend user id
// (rather than a locally generated fingerprint), so reinstalling the
// extension -- or switching to a different browser or machine -- still
// restores the same saved layout instead of starting over.
function screenKey(viewport: ViewportInfo): string {
  return `${viewport.screenWidth}x${viewport.screenHeight}`;
}

interface PositionRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
}

export interface PositionData {
  top: number;
  left: number;
  width: number;
  height: number;
  z: number;
}

export interface StoredPosition extends PositionData {
  id: string;
}

function toRatio(pos: PositionData, viewport: ViewportInfo) {
  return {
    x: pos.left / viewport.windowWidth,
    y: pos.top / viewport.windowHeight,
    width: pos.width,
    height: pos.height,
    // z is a stacking order, not a screen coordinate, so it's stored
    // and restored as-is rather than as a window-relative ratio.
    z: pos.z,
  };
}

// Converts a stored ratio back into pixel coordinates for the content
// page's window, clamping so the note can't be restored off-screen --
// e.g. after shrinking the window, or loading on a smaller device.
function fromRatio(record: PositionRecord, viewport: ViewportInfo): PositionData {
  const left = record.x * viewport.windowWidth;
  const top = record.y * viewport.windowHeight;
  return {
    left: Math.min(Math.max(left, 0), Math.max(viewport.windowWidth - record.width, 0)),
    top: Math.min(Math.max(top, 0), Math.max(viewport.windowHeight - record.height, 0)),
    width: record.width,
    height: record.height,
    z: record.z,
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
    const record = await pb.collection("positions").getFirstListItem<PositionRecord>(
      pb.filter("annotation = {:annotation} && user = {:user} && screen = {:screen}", {
        annotation: annotationId,
        user: userId,
        screen: screenKey(viewport),
      }),
    );
    return { id: record.id, ...fromRatio(record, viewport) };
  } catch (err) {
    // getFirstListItem throws a 404 when no record matches; no saved
    // position yet is a normal case, not an error.
    if (err instanceof ClientResponseError && err.status === 404) return undefined;
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
    screen: screenKey(viewport),
    ...toRatio(pos, viewport),
  };

  if (existingId) {
    await pb.collection("positions").update(existingId, data);
    return existingId;
  }

  const created = await pb.collection("positions").create<PositionRecord>(data);
  return created.id;
}
