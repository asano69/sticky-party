import { createSignal, Show } from 'solid-js';
import Home from './Home';
import Settings from './Settings';
import Targets from './Targets';
import NavBar, { type View } from './NavBar';
import { fullSyncTargets } from '../../lib/targets';

// Three-screen popup, switched via NavBar's mode toggle. Home (create an
// annotation) is the default view; Targets (cached URL list) and
// Settings are the other two.
function App() {
  const [view, setView] = createSignal<View>('home');
  const [syncing, setSyncing] = createSignal(false);

  // Manual full sync (fetch every target from PocketBase, overwrite the
  // local cache) on top of the automatic write-through/periodic sync.
  // Lives here (rather than in Targets.tsx) since it's a global action,
  // not specific to the cached-URLs view.
  const handleSync = async () => {
    setSyncing(true);
    try {
      await fullSyncTargets();
    } catch (err) {
      console.error('[sticky-party] full sync failed', err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div class="w-[260px]">
      <NavBar view={view()} onViewChange={setView} syncing={syncing()} onSync={handleSync} />

      <Show when={view() === 'home'} fallback={
        <Show when={view() === 'settings'} fallback={<Targets />}>
          <Settings />
        </Show>
      }>
        <Home />
      </Show>
    </div>
  );
}

export default App;
