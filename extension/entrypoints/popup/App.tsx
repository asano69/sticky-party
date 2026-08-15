import { createSignal, Show } from 'solid-js';
import { ArrowLeft, Settings as SettingsIcon } from 'lucide-solid';
import './App.css';
import Home from './Home';
import Settings from './Settings';

// Two-screen popup. Home (create an annotation) is the default view;
// Settings is reached via the header icon, which doubles as a back button
// while Settings is open.
type View = 'home' | 'settings';

function App() {
  const [view, setView] = createSignal<View>('home');

  return (
    <div class="popup">
      <header class="popup-header">
        <h1>web-anno</h1>
        <Show
          when={view() === 'home'}
          fallback={
            <button
              type="button"
              class="icon-btn"
              onClick={() => setView('home')}
              aria-label="Back"
            >
              <ArrowLeft size={18} />
            </button>
          }
        >
          <button
            type="button"
            class="icon-btn"
            onClick={() => setView('settings')}
            aria-label="Settings"
          >
            <SettingsIcon size={18} />
          </button>
        </Show>
      </header>

      <Show when={view() === 'home'} fallback={<Settings />}>
        <Home />
      </Show>
    </div>
  );
}

export default App;
