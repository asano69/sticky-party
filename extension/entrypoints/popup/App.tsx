import { createSignal, Show } from 'solid-js';
import ArrowLeft from 'lucide-solid/icons/arrow-left';
import NotebookTabs from 'lucide-solid/icons/notebook-tabs';
import SettingsIcon from 'lucide-solid/icons/settings';
import { Button } from '@kobalte/core/button';
import './App.css';
import Home from './Home';
import Settings from './Settings';
import Targets from './Targets';

// Three-screen popup. Home (create an annotation) is the default view;
// Targets (cached URL list) and Settings are reached via the header
// icons, which are replaced by a single back button while either is open.
type View = 'home' | 'settings' | 'targets';

function App() {
  const [view, setView] = createSignal<View>('home');

  return (
    <div class="popup">
      <header class="popup-header">
        <h1>Note</h1>
        <Show
          when={view() === 'home'}
          fallback={
            <Button
              class="icon-btn"
              onClick={() => setView('home')}
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </Button>
          }
        >
          <div class="header-actions">
            <Button
              class="icon-btn"
              onClick={() => setView('targets')}
              aria-label="Cached URLs"
            >
              <NotebookTabs size={18} />
            </Button>
            <Button
              class="icon-btn"
              onClick={() => setView('settings')}
              aria-label="Settings"
            >
              <SettingsIcon size={18} />
            </Button>
          </div>
        </Show>
      </header>

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
