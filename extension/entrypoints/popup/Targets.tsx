import { createResource, createSignal, For, Show } from 'solid-js';
import { RefreshCw } from 'lucide-solid';
import { getCachedTargets, fullSyncTargets } from '../../lib/targets';

// Read-only view of the local target cache (see docs/architecture.md).
// Lets you sanity-check that write-through/full-sync is populating the
// cache without opening devtools. The refresh button triggers a manual
// full sync (fetch every target from PocketBase, overwrite the local
// cache) on top of the automatic write-through/periodic sync.
export default function Targets() {
  const [targets, { refetch }] = createResource(getCachedTargets);
  const [syncing, setSyncing] = createSignal(false);
  const [error, setError] = createSignal('');

  const handleRefresh = async () => {
    setError('');
    setSyncing(true);
    try {
      await fullSyncTargets();
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div class="card">
      <button
        type="button"
        class="icon-btn"
        onClick={handleRefresh}
        disabled={syncing()}
        aria-label="Sync from server"
      >
        <RefreshCw size={16} class={syncing() ? 'spin' : ''} />
      </button>

      {error() && <p class="saved-hint">{error()}</p>}

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

