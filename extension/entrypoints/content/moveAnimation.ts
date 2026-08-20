// Smoothly animates a note wrapper to a new (top, left) using the FLIP
// technique (First, Last, Invert, Play) instead of transitioning
// top/left directly. top/left remain the note's real, authoritative
// position -- read and written directly by drag, resize, and
// window-resize rescaling elsewhere (see mountNote.ts) -- this only
// layers a temporary `transform: translate()` on top of them.
//
// Animating top/left directly forces the browser to redo Layout and
// Paint on every frame, since both affect an element's box in the
// document flow. `transform` is a compositor-only property: the
// browser can animate it purely on the GPU, skipping Layout and Paint
// entirely. Extracted into its own module since it's a generic,
// reusable animation primitive, independent of any single note's
// drag/resize/pin logic.
//
// Only used for remote pin/position updates (see applyRemotePin in
// mountNote.ts) -- drag and window-resize rescaling both need instant,
// 1:1 tracking, so they write top/left directly instead of going
// through this.

const MOVE_DURATION_MS = 300;
// An "ease-in-out" curve: slow at both ends, fastest through the
// middle. The first control point (0.4, 0) sits closer to the origin
// than a more extreme curve like (0.65, 0, 0.35, 1) would use --
// velocity ramps up gradually from the very start instead of staying
// near zero for a while and then kicking off abruptly. That abrupt
// kickoff is a sudden change in acceleration ("jerk"), which reads as
// jankiness even when every frame is actually rendering on time.
// Symmetric with the matching end-side control point (0.2, 1), so
// the deceleration into the final position is equally gradual.
const MOVE_EASING = "cubic-bezier(0.25, 0, 0.2, 1)";

export function animateMove(wrapper: HTMLElement, top: number, left: number) {
  // First: read the wrapper's current on-screen position before
  // changing anything.
  const from = wrapper.getBoundingClientRect();

  // Last: jump straight to the new position. No transition on
  // top/left themselves, so this alone would be an instant, invisible
  // jump.
  wrapper.style.transition = "";
  wrapper.style.top = `${top}px`;
  wrapper.style.left = `${left}px`;

  // Invert: counter-translate the element back to where it visually
  // was a moment ago, canceling out the jump above.
  const to = wrapper.getBoundingClientRect();
  const deltaX = from.left - to.left;
  const deltaY = from.top - to.top;
  if (deltaX === 0 && deltaY === 0) return; // nothing to animate

  wrapper.style.transform = `translate(${deltaX}px, ${deltaY}px)`;

  // Hints the browser to promote the wrapper onto its own compositor
  // layer up front, rather than leaving the promotion timing to
  // heuristics -- without this, the very first animateMove call on a
  // given wrapper can occasionally miss a frame of GPU compositing
  // while the browser decides to promote it. Cleared once the
  // animation ends (see the timeout below) since holding a layer open
  // indefinitely costs GPU memory for no benefit outside an active
  // animation.
  wrapper.style.willChange = "transform";

  // Force a reflow so the browser registers the inverted transform as
  // a real starting point before the transition below is applied --
  // otherwise the translate(deltaX, deltaY) above and the translate(0,
  // 0) below could be coalesced into a single style recalculation with
  // no visible animation at all.
  void wrapper.offsetWidth;

  // Play: transition the transform back to none. The compositor
  // animates this on the GPU without per-frame layout/paint.
  wrapper.style.transition = `transform ${MOVE_DURATION_MS}ms ${MOVE_EASING}`;
  wrapper.style.transform = "";

  window.setTimeout(() => {
    wrapper.style.transition = "";
    wrapper.style.willChange = "";
  }, MOVE_DURATION_MS);
}
