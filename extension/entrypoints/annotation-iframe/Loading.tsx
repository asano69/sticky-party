// Shown in place of the note's content while annotation data is still
// being loaded, i.e. before NoteContent.tsx's `annotation` signal is
// populated (see its Show fallback).
export default function Loading() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-transparent">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-500 dark:border-neutral-700 dark:border-t-neutral-300" />
    </div>
  );
}
