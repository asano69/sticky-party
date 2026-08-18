import { Show } from "solid-js";
import { CARD } from "./classes";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { Button } from "@kobalte/core/button";
import SquarePen from "lucide-solid/icons/square-pen";
import NotebookTabs from "lucide-solid/icons/notebook-tabs";
import SettingsIcon from "lucide-solid/icons/settings";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import RefreshCwOff from "lucide-solid/icons/refresh-cw-off";
import { ICON_BTN } from "./classes";

export type View = "home" | "settings" | "targets";

// Header shown atop every popup screen. The three views are switched via
// Kobalte's ToggleGroup in single-select mode, so exactly one is always
// active -- this replaces the old back-button/conditional-header setup,
// since all three icons can now just stay visible all the time. Sync is
// a one-off action rather than a view, so it stays outside the group,
// placed right next to the title instead.
export default function NavBar(props: {
  view: View;
  onViewChange: (view: View) => void;
  syncing: boolean;
  onSync: () => void;
  // True until backend credentials are confirmed saved (see App.tsx's
  // checkConfigured); while true, Home/Targets are disabled and only
  // Settings can be reached, since neither of the other views can do
  // anything useful without a working connection.
  locked: boolean;
  // Mirrors lib/syncBadge.ts's stored error flag -- swaps the Sync
  // button to a red "off" icon so a failed connection is visible even
  // in environments where the toolbar badge itself isn't (see
  // App.tsx).
  syncError: boolean;
  // Total annotation count fetched on popup open (see App.tsx's
  // checkConfigured/handleSync). undefined until the first fetch
  // resolves -- shown as nothing rather than "0" so it's not mistaken
  // for a real (zero) count while still loading.
  count?: number;
}) {
  return (
    <header class="flex items-center justify-between px-3 pt-3">
      <div class="flex items-center gap-1">
        <div class="font-bold">Note</div>
        <Button
          class={ICON_BTN}
          onClick={props.onSync}
          disabled={props.syncing || props.locked}
          aria-label={
            props.syncError
              ? "Sync failed -- click to retry"
              : "Sync from server"
          }
        >
          <Show
            when={!props.syncError}
            fallback={<RefreshCwOff size={18} class="text-[#c0392b]" />}
          >
            <RefreshCw size={18} class={props.syncing ? "animate-spin" : ""} />
          </Show>
        </Button>
      </div>

      <ToggleGroup
        value={props.view}
        // Guard against `value` being null: ToggleGroup in single
        // mode reports null when the active item is toggled off, but
        // this group is a mode switcher, not an optional filter -- one
        // view must always stay selected.
        onChange={(value) => value && props.onViewChange(value as View)}
        class="flex gap-1"
      >
        <ToggleGroup.Item
          value="home"
          disabled={props.locked}
          class={`${ICON_BTN} data-[pressed]:bg-black/10 data-[disabled]:opacity-40 data-[disabled]:cursor-default`}
          aria-label="Home"
        >
          <SquarePen size={18} />
        </ToggleGroup.Item>
        <ToggleGroup.Item
          value="targets"
          disabled={props.locked}
          class={`${ICON_BTN} data-[pressed]:bg-black/10 data-[disabled]:opacity-40 data-[disabled]:cursor-default`}
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
    </header>
  );
}
