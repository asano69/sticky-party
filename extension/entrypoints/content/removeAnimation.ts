// Plays the "note is going away" animations for a note's wrapper
// element, then calls `onDone`. Extracted from mountNote.ts since this
// is generic animation logic independent of any single note's drag/
// resize/pin/iframe-messaging state -- same reasoning as
// moveAnimation.ts's animateMove.
//
// Both animations are applied directly to the wrapper rather than a
// cloned snapshot: the content script has no DOM access to the note's
// own colors or text, since those are rendered inside a
// same-extension-but-cross-origin iframe (see mountNote.ts's header
// comment) -- but clip-path/opacity/transform on the wrapper still
// visually crops and moves whatever that iframe renders, without
// needing to read into it.

// Duration of the fade-out/shrink played by removeFaded below (used
// when the user dismisses a note, i.e. hides it from view without
// deleting the underlying annotation).
const REMOVE_DURATION_MS = 200;

// Duration of the shredder animation played by removeShredded below
// (used for an actual delete). Longer than REMOVE_DURATION_MS since it
// has more visual steps -- teeth cutting progressively higher up the
// note -- that need time to read clearly.
const SHRED_DURATION_MS = 550;

// Builds a jagged "shredder teeth" clip-path that keeps everything
// above `cutPercent` (a percentage of the box's height, from the top)
// visible and clips everything below it away along a zigzag line
// instead of a straight edge. removeShredded below steps a wrapper
// through a few of these at increasing cutPercent, so the note reads
// as being chewed apart from the bottom rather than wiped away
// smoothly.
function shredderClipPath(cutPercent: number): string {
  const teeth = 6;
  const toothHeight = 6; // extra "bite" per tooth, in percentage points
  const points = ["0% 0%", "100% 0%", `100% ${cutPercent}%`];
  for (let i = teeth; i >= 0; i--) {
    const x = (i / teeth) * 100;
    const y = cutPercent + (i % 2 === 0 ? 0 : toothHeight);
    points.push(`${x}% ${y}%`);
  }
  return `polygon(${points.join(", ")})`;
}

// Fade + shrink, used when the user dismisses a note (the header's X
// button) -- the note is only hidden from view, not deleted, so this
// stays a plain fade rather than removeShredded's flashier delete
// animation. Both opacity and transform are compositor-only
// properties (same reasoning as animateMove), so this costs no extra
// Layout/Paint work per frame -- no canvas/WebGL involved.
export function removeFaded(wrapper: HTMLElement, onDone: () => void) {
  wrapper.style.willChange = "opacity, transform";
  wrapper.style.transition = `opacity ${REMOVE_DURATION_MS}ms ease, transform ${REMOVE_DURATION_MS}ms ease`;
  wrapper.style.opacity = "0";
  wrapper.style.transform = "scale(0.85)";
  window.setTimeout(onDone, REMOVE_DURATION_MS);
}

// Jagged, torn-paper "shredder" animation, used for a genuine delete
// (this viewer's own trash button, or another viewer deleting the
// note remotely).
export function removeShredded(wrapper: HTMLElement, onDone: () => void) {
  wrapper.style.willChange = "clip-path, transform, opacity";
  const anim = wrapper.animate(
    [
      {
        clipPath: shredderClipPath(100),
        transform: "translateY(0) rotate(0deg)",
        opacity: 1,
      },
      {
        clipPath: shredderClipPath(65),
        transform: "translateY(6px) rotate(-2deg)",
        opacity: 1,
        offset: 0.4,
      },
      {
        clipPath: shredderClipPath(30),
        transform: "translateY(16px) rotate(2deg)",
        opacity: 0.6,
        offset: 0.75,
      },
      {
        clipPath: shredderClipPath(0),
        transform: "translateY(32px) rotate(-3deg)",
        opacity: 0,
      },
    ],
    { duration: SHRED_DURATION_MS, easing: "ease-in" },
  );
  anim.onfinish = onDone;
}
