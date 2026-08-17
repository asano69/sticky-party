import { ToggleGroup } from '@kobalte/core/toggle-group';
import { Button } from '@kobalte/core/button';
import SquarePen from 'lucide-solid/icons/square-pen';
import NotebookTabs from 'lucide-solid/icons/notebook-tabs';
import SettingsIcon from 'lucide-solid/icons/settings';
import RefreshCw from 'lucide-solid/icons/refresh-cw';
import { ICON_BTN } from './classes';

export type View = 'home' | 'settings' | 'targets';

// Header shown atop every popup screen. The three views are switched via
// Kobalte's ToggleGroup in single-select mode, so exactly one is always
// active -- this replaces the old back-button/conditional-header setup,
// since all three icons can now just stay visible all the time. Sync is
// a one-off action rather than a view, so it stays outside the group.
export default function NavBar(props: {
  view: View;
  onViewChange: (view: View) => void;
  syncing: boolean;
  onSync: () => void;
}) {
  return (
    <header class="flex items-center justify-between px-3 pt-3">
      <h1 class="m-0 text-[1.1em] leading-tight font-bold">Note</h1>
      <div class="flex items-center gap-1">
        <Button
          class={ICON_BTN}
          onClick={props.onSync}
          disabled={props.syncing}
          aria-label="Sync from server"
        >
          <RefreshCw size={18} class={props.syncing ? 'animate-spin' : ''} />
        </Button>

        <ToggleGroup
          value={props.view}
          // Guard against `value` being null: ToggleGroup in single
          // mode reports null when the active item is toggled off, but
          // this group is a mode switcher, not an optional filter -- one
          // view must always stay selected.
          onChange={(value) => value && props.onViewChange(value as View)}
          class="flex gap-1"
        >
          <ToggleGroup.Item value="home" class={`${ICON_BTN} data-[pressed]:bg-black/10`} aria-label="Home">
            <SquarePen size={18} />
          </ToggleGroup.Item>
          <ToggleGroup.Item
            value="targets"
            class={`${ICON_BTN} data-[pressed]:bg-black/10`}
            aria-label="Cached URLs"
          >
            <NotebookTabs size={18} />
          </ToggleGroup.Item>
          <ToggleGroup.Item
            value="settings"
            class={`${ICON_BTN} data-[pressed]:bg-black/10`}
            aria-label="Settings"
          >
            <SettingsIcon size={18} />
          </ToggleGroup.Item>
        </ToggleGroup>
      </div>
    </header>
  );
}
