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
  // The single persistent element that owns the note's visual padding
  // and wraps whichever content (edit textarea or read-only body) is
  // currently shown (see NoteMain.tsx). Unlike <main> itself (a
  // flex-1/overflow-auto box whose own size is dictated by the flex
  // layout, not its content), this plain block div has no such
  // constraint, so its own box naturally shrinks/grows to fit
  // whatever it contains, in either mode. That means a single
  // ResizeObserver target and a single scrollHeight read now cover
  // both editing and view mode, with no per-mode padding arithmetic
  // needed on the JS side -- the padding lives on this element
  // itself, so it's already included in its own box.
  let measuredContentRef: HTMLElement | undefined;
  // The edit-mode footer's own element (see NoteFooter.tsx). Only
  // mounted while editing, but that's exactly the one branch of
  // reportContentHeight that needs it -- see below. Reading its real
  // offsetHeight replaces content.ts's old approximation (assuming the
  // footer is exactly TITLE_ROW_HEIGHT_PX tall) with an exact
  // measurement, since the footer is this iframe's own DOM element.
  let footerRef: HTMLElement | undefined;

  // Grows the textarea to fit its content, with a 1-line floor (see
  // rows={1} in NoteMain.tsx) so a short note still gets a comfortable
  // minimum size. Setting height to "auto" first lets scrollHeight
  // reflect that floor: with no CSS height set, a textarea's
  // intrinsic height comes from `rows`, and scrollHeight can never be
  // smaller than that box.
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
  // measuredContentRef already includes its own padding (see the
  // comment above), so its scrollHeight alone is the correct content
  // height for either mode. The only thing added on top is the
  // footer's own real height, and only while editing, since the
  // footer is a flex sibling of <main> (see NoteContent.tsx) rather
  // than something measuredContentRef wraps.
  const reportContentHeight = () => {
    // Captured once so the measurement and the `editing` flag sent
    // alongside it always describe the same moment -- see
    // lib/iframe-messages.ts's NoteContentResizeMessage comment.
    const editing = params.editing();
    let height = measuredContentRef?.scrollHeight ?? 0;
    if (editing) height += footerRef?.offsetHeight ?? 0;
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

  // Watches measuredContentRef for size changes that happen entirely
  // on their own -- e.g. a pasted image's async load finishing, or a
  // code block's syntax-highlighted HTML arriving from the backend
  // (see lib/renders.ts) -- so the wrapper's auto-sized preview height
  // (see docs/note-sizing.md) keeps following the content instead of
  // only ever reflecting whatever was measurable at mount time.
  // reportContentHeight always reads whatever is currently inside
  // measuredContentRef, so this observer fires unconditionally in
  // either mode without ever sending a wrong value.
  const contentResizeObserver = new ResizeObserver(() => reportContentHeight());
  onCleanup(() => contentResizeObserver.disconnect());

  // Ref callback for the single persistent wrapper div in
  // NoteMain.tsx (stays mounted across the editing/view <Show>; only
  // its children swap). Reports the note's initial content height
  // once on mount (queueMicrotask, so the DOM has settled first) --
  // without this, a note that never enters edit mode would otherwise
  // never send NOTE_CONTENT_RESIZE_MESSAGE at all, leaving
  // content.ts's loading spinner (see
  // entrypoints/content/noteChrome.ts) spinning forever.
  const setMeasuredContentRef = (el: HTMLElement) => {
    measuredContentRef = el;
    queueMicrotask(reportContentHeight);
    contentResizeObserver.observe(el);
  };

  // Ref callback for the textarea: also resizes immediately on mount,
  // matching the old inline
  // `ref={(el) => { textareaRef = el; resizeTextarea(); }}`.
  const setTextareaRef = (el: HTMLTextAreaElement) => {
    textareaRef = el;
    resizeTextarea();
  };

  // Ref callback for the edit-mode footer. Mounted/unmounted along
  // with editing itself (see NoteContent.tsx's <Show when={editing()}>),
  // so footerRef is only ever read from reportContentHeight's editing
  // branch above, which is the only place it's needed.
  const setFooterRef = (el: HTMLElement) => {
    footerRef = el;
  };

  const focusTextarea = () => textareaRef?.focus();

  return {
    setTextareaRef,
    setMeasuredContentRef,
    setFooterRef,
    resizeTextarea,
    reportContentHeight,
    focusTextarea,
  };
}
