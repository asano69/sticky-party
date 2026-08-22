// Computes and reports a note's content height to the parent document
// (content.ts owns the wrapper element that actually gets resized --
// see docs/note-sizing.md for the full height-calculation spec this
// implements). Extracted out of NoteContent.tsx since this logic is
// pure sizing/measurement, independent of the rest of the note's UI.

import { createEffect, onCleanup } from "solid-js";
import { NOTE_CONTENT_RESIZE_MESSAGE } from "../../lib/iframe-messages";

export function useContentHeight(params: {
  editing: () => boolean;
  draft: () => string;
  draftTitle: () => string;
}) {
  let textareaRef: HTMLTextAreaElement | undefined;
  // HTMLElement, not HTMLDivElement: this is attached to NoteMain.tsx's
  // <main>, which is an HTMLElement, not an HTMLDivElement.
  let contentRef: HTMLElement | undefined;

  // Grows the textarea to fit its content, with a 4-line floor (see
  // rows={4} in NoteContent.tsx) so a short note still gets a
  // comfortable minimum size. Setting height to "auto" first lets
  // scrollHeight reflect that floor: with no CSS height set, a
  // textarea's intrinsic height comes from `rows`, and scrollHeight
  // can never be smaller than that box.
  const resizeTextarea = () => {
    const el = textareaRef;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };

  // Reports the note's full (unclipped) content height to the content
  // script so it can resize the wrapper element -- which lives in the
  // host page's document, not this iframe -- to fit.
  //
  // While editing, this deliberately does NOT read contentRef.scrollHeight:
  // contentRef is a `flex-1` flex item, so its own box is stretched to
  // fill whatever height the note currently has. Once the note has grown,
  // contentRef's box stays that size even after the textarea inside it
  // shrinks (no overflow means scrollHeight just reflects the box itself),
  // so shrinking on line-delete would never be detected. Reading
  // textareaRef's own height instead -- which resizeTextarea keeps
  // accurate every keystroke -- avoids that trap and shrinks correctly.
  // contentRef's vertical padding (py-1.5) is added back since it isn't
  // part of the textarea's own box.
  //
  // The footer (a flex sibling of contentRef in NoteContent.tsx) is not
  // measured here, so it never contributes to the note's required
  // height -- only main's own content does. content.ts (which owns the
  // wrapper element) is what temporarily adds the footer's height back
  // in while editing.
  const reportContentHeight = () => {
    let height = 0;
    // Captured once so the measurement and the `editing` flag sent
    // alongside it always describe the same moment -- see
    // lib/iframe-messages.ts's NoteContentResizeMessage comment.
    const editing = params.editing();
    if (editing && textareaRef && contentRef) {
      const { paddingTop, paddingBottom } = getComputedStyle(contentRef);
      height =
        textareaRef.offsetHeight +
        parseFloat(paddingTop) +
        parseFloat(paddingBottom);
    } else {
      height = contentRef?.scrollHeight ?? 0;
    }
    window.parent.postMessage(
      { type: NOTE_CONTENT_RESIZE_MESSAGE, height, editing },
      "*",
    );
  };

  // Re-measure whenever the draft text/title changes while editing, so
  // the wrapper keeps growing as the user types.
  createEffect(() => {
    params.draft();
    params.draftTitle();
    if (!params.editing()) return;
    resizeTextarea();
    queueMicrotask(reportContentHeight);
  });

  // Watches contentRef for size changes that happen entirely on their
  // own -- e.g. a pasted image's async load finishing, or a code
  // block's syntax-highlighted HTML arriving from the backend (see
  // lib/renders.ts) -- so the wrapper's auto-sized preview height
  // (see docs/note-sizing.md) keeps following the content instead of
  // only ever reflecting whatever was measurable at mount time.
  // reportContentHeight already picks the right measurement for the
  // current mode (editing vs. view -- see above), so this observer
  // fires unconditionally in either mode without sending a wrong
  // value.
  const contentResizeObserver = new ResizeObserver(() => reportContentHeight());
  onCleanup(() => contentResizeObserver.disconnect());

  // Ref callback for the view-mode content wrapper in NoteMain.tsx --
  // the plain block div wrapping AnnotationBody, NOT <main> itself.
  // <main> is a flex-1/overflow-auto box, so its own rendered size is
  // dictated by the flex layout (i.e. by however tall the host-side
  // wrapper currently is), not by its content -- ResizeObserver only
  // reports changes to an element's own box, never to content that
  // merely overflows within a fixed-size box, so observing <main>
  // alone misses content that grows without <main>'s own box
  // resizing (e.g. an attachment image finishing its async load, or a
  // code block's highlighted HTML arriving -- see lib/renders.ts).
  // This inner div has no such constraint, so its box does grow/
  // shrink with its actual content, and observing it here catches
  // those cases. It's recreated every time the note toggles out of
  // and back into view mode (see NoteMain.tsx's <Show>), so this ref
  // callback re-observes the new instance each time; reusing the same
  // contentResizeObserver instance is fine since ResizeObserver can
  // watch multiple elements at once.
  const setBodyRef = (el: HTMLElement) => {
    contentResizeObserver.observe(el);
  };

  // Ref callback for the textarea: also resizes immediately on mount,
  // matching the old inline `ref={(el) => { textareaRef = el; resizeTextarea(); }}`.
  const setTextareaRef = (el: HTMLTextAreaElement) => {
    textareaRef = el;
    resizeTextarea();
  };

  const setContentRef = (el: HTMLElement) => {
    contentRef = el;
    // Reports the note's initial content height once on mount. The
    // createEffect above only reports while editing (see its early
    // return), so a note that's never entered edit mode would
    // otherwise never send NOTE_CONTENT_RESIZE_MESSAGE at all --
    // leaving content.ts's loading spinner (see entrypoints/content.ts)
    // spinning forever.
    queueMicrotask(reportContentHeight);
    contentResizeObserver.observe(el);
  };

  const focusTextarea = () => textareaRef?.focus();

  return {
    setTextareaRef,
    setContentRef,
    setBodyRef,
    resizeTextarea,
    reportContentHeight,
    focusTextarea,
  };
}
