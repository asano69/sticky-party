import { createResource, For, Show } from 'solid-js';
import { getCachedTargets } from '../../lib/targets';

// Read-only view of the local target cache (see docs/architecture.md).
// Lets you sanity-check that write-through/full-sync is populating the
// cache without opening devtools. The manual full-sync trigger lives in
// App.tsx's header (next to Settings/Cached URLs) since it's a global
// action, not specific to this view; this component just re-reads the
// cache each time it mounts.
export default function Targets() {
  const [targets] = createResource(getCachedTargets);

  return (
    <div class="card">
      <Show
        when={(targets() ?? []).length > 0}
        fallback={<p class="saved-hint">No cached URLs yet.</p>}
      >
        <ul class="target-list">
          <For each={targets()}>
            {(target) => <li class="target-item">{target}</li>}
          </For>
        </ul>
      </Show>
    </div>
  );
}

