// Reads and writes a sticky note's on-page position and size, persisted
// per (annotation, device) in the `positions` collection so each device
// keeps its own layout (see AnnotationBoard.tsx).
//
// x/y are stored as ratios of the window's inner width/height rather
// than raw pixels, since window size varies across devices (and across
// resizes of the same window); width/height are stored as raw pixels,
// since sticky notes have a fixed min-size regardless of window size.

import { ClientResponseError } from "pocketbase";

import { getAuthedPb } from "./pb";
import { ensureFingerprint, getSettings } from "./settings";

// Combines the browser fingerprint with this display's resolution, so a
// dual-monitor setup keeps a separate saved layout per screen instead of
// two monitors fighting over the same stored position (e.g. a laptop
// docked to an external display with a different resolution).
function deviceKey(fingerprint: string): string {
  return `${fingerprint}@${screen.width}x${screen.height}`;
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

function toRatio(pos: PositionData) {
  return {
    x: pos.left / window.innerWidth,
    y: pos.top / window.innerHeight,
    width: pos.width,
    height: pos.height,
    // z is a stacking order, not a screen coordinate, so it's stored
    // and restored as-is rather than as a window-relative ratio.
    z: pos.z,
  };
}

// Converts a stored ratio back into pixel coordinates for the current
// window, clamping so the note can't be restored off-screen -- e.g.
// after shrinking the window, or loading on a smaller device.
function fromRatio(record: PositionRecord): PositionData {
  const left = record.x * window.innerWidth;
  const top = record.y * window.innerHeight;
  return {
    left: Math.min(Math.max(left, 0), Math.max(window.innerWidth - record.width, 0)),
    top: Math.min(Math.max(top, 0), Math.max(window.innerHeight - record.height, 0)),
    width: record.width,
    height: record.height,
    z: record.z,
  };
}

// Fetches this device's saved position for an annotation, if any.
export async function fetchPosition(annotationId: string): Promise<StoredPosition | undefined> {
  await ensureFingerprint();
  const settings = await getSettings();
  const pb = await getAuthedPb();

  try {
    const record = await pb.collection("positions").getFirstListItem<PositionRecord>(
      pb.filter("annotation = {:annotation} && device = {:device}", {
        annotation: annotationId,
        device: deviceKey(settings!.fingerprint),
      }),
    );
    return { id: record.id, ...fromRatio(record) };
  } catch (err) {
    // getFirstListItem throws a 404 when no record matches; no saved
    // position yet is a normal case, not an error.
    if (err instanceof ClientResponseError && err.status === 404) return undefined;
    throw err;
  }
}

// Saves this device's position/size for an annotation. Pass the id
// returned by a previous fetchPosition/savePosition call to update that
// record instead of creating a new one.
export async function savePosition(
  annotationId: string,
  pos: PositionData,
  existingId?: string,
): Promise<string> {
  await ensureFingerprint();
  const settings = await getSettings();
  const pb = await getAuthedPb();
  const data = {
    annotation: annotationId,
    device: deviceKey(settings!.fingerprint),
    ...toRatio(pos),
  };

  if (existingId) {
    await pb.collection("positions").update(existingId, data);
    return existingId;
  }

  const created = await pb.collection("positions").create<PositionRecord>(data);
  return created.id;
}
