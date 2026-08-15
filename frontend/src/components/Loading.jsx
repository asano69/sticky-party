// A small, self-contained CSS spinner shown in place of "Loading…" text,
// e.g. as the fallback of a <Show> around a createResource(). Kept as its
// own component so every route that fetches data shares the same look.
export default function Loading() {
  return (
    <div class="flex w-full items-center justify-center py-12">
      <div class="h-10 w-10 animate-spin rounded-full border-4 border-neutral-200 border-t-neutral-500 dark:border-neutral-700 dark:border-t-neutral-300" />
    </div>
  );
}
