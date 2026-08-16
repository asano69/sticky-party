import { createResource, For, Show } from 'solid-js';
import { getCachedTargets } from '../../lib/targets';
import { CARD, SAVED_HINT } from './classes';

// Read-only view of the local target cache (see docs/architecture.md).
// Lets you sanity-check that write-through/full-sync is populating the
// cache without opening devtools. The manual full-sync trigger lives in
// App.tsx's header (next to Settings/Cached URLs) since it's a global
// action, not specific to this view; this component just re-reads the
// cache each time it mounts.
export default function Targets() {
  const [targets] = createResource(getCachedTargets);

  return (
    <div class={CARD}>
      <Show when={(targets() ?? []).length > 0} fallback={<p class={SAVED_HINT}>No cached URLs yet.</p>}>
        <ul class="m-0 flex max-h-[200px] list-none flex-col gap-1 overflow-y-auto p-0">
          <For each={targets()}>
            {(target) => (
              <li class="break-all rounded-md border border-[color:var(--note-button-border)] px-2 py-1 text-[0.8em]">
                {target}
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}

