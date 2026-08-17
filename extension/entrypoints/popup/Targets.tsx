import { createMemo, createResource, createSignal, For, Show } from "solid-js";
import { TextField } from "@kobalte/core/text-field";
import { Link } from "@kobalte/core/link";
import { getCachedTargets } from "../../lib/targets";
import { CARD, FIELD, FIELD_INPUT, FIELD_LABEL, SAVED_HINT } from "./classes";

// A target is only a clickable link if it's an actual URL. Wildcard/regex
// targets (not yet implemented, but planned -- see docs/architecture.md's
// "未確定事項") aren't real addresses, so `new URL` throwing is treated as
// "not clickable" rather than trying to detect wildcard/regex syntax
// ourselves.
function isClickableTarget(target: string): boolean {
  try {
    new URL(target);
    return true;
  } catch {
    return false;
  }
}

// Strips the scheme to save horizontal space in the list; the full
// target (scheme included) is still used as the actual href.
function displayTarget(target: string): string {
  return target.replace(/^https?:\/\//, "");
}

// Read-only view of the local target cache (see docs/architecture.md).
// Lets you sanity-check that write-through/full-sync is populating the
// cache without opening devtools. The manual full-sync trigger lives in
// App.tsx's header (next to Settings/Cached URLs) since it's a global
// action, not specific to this view; this component just re-reads the
// cache each time it mounts.
export default function Targets() {
  const [targets] = createResource(getCachedTargets);
  const [query, setQuery] = createSignal("");

  // Case-insensitive substring match, recomputed on every keystroke so
  // the list narrows incrementally. No network round trip: it just
  // filters the already-cached target list held in `targets`.
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    const all = targets() ?? [];
    return q ? all.filter((target) => target.toLowerCase().includes(q)) : all;
  });

  return (
    <div class={CARD}>
      {/* > 0, not > 1: a single cached URL should still render the
          search box and list, not fall back to the empty state. */}
      <Show
        when={(targets() ?? []).length > 0}
        fallback={<p class={SAVED_HINT}>No cached URLs yet.</p>}
      >
        <TextField class={FIELD} value={query()} onChange={setQuery}>
          <TextField.Label class={FIELD_LABEL}>Search</TextField.Label>
          <TextField.Input
            class={FIELD_INPUT}
            type="search"
            placeholder="Search cached URLs…"
          />
        </TextField>

        <Show
          when={filtered().length > 0}
          fallback={<p class={SAVED_HINT}>No matches.</p>}
        >
          <ul class="m-0 flex max-h-[200px] list-none flex-col gap-1 overflow-y-auto p-0">
            <For each={filtered()}>
              {(target) => (
                <li>
                  <Link
                    href={target}
                    disabled={!isClickableTarget(target)}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block truncate text-[0.8em] text-inherit underline data-[disabled]:no-underline data-[disabled]:opacity-50 data-[disabled]:cursor-default"
                  >
                    {displayTarget(target)}
                  </Link>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>
    </div>
  );
}
