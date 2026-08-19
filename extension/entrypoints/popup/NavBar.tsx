import { Show } from "solid-js";
import { ToggleGroup } from "@kobalte/core/toggle-group";
import { Button } from "@kobalte/core/button";
import SquarePen from "lucide-solid/icons/square-pen";
import NotebookTabs from "lucide-solid/icons/notebook-tabs";
import SettingsIcon from "lucide-solid/icons/settings";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import RefreshCwOff from "lucide-solid/icons/refresh-cw-off";
import { ICON_BTN } from "./classes";
import type { NoteColor } from "../../lib/colors";
import ColorPicker from "./ColorPicker";

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
  // Total annotation count shown next to NavBar's Sync icon. undefined
  // until the first fetch resolves (see checkConfigured/handleSync); a
  // failed fetch leaves the previous value in place rather than
  // clearing it, so the number doesn't flicker away on a transient
  // error.
  count?: number;
  // Currently selected note/popup color and its setter (see
  // App.tsx's bgColor/handleBgColorChange) -- shown here so the color
  // picker sits next to the "Note" heading rather than inside Home.tsx.
  color: NoteColor;
  onColorChange: (color: NoteColor) => void;
}) {
  return (
    <header class="flex items-center justify-between px-3 pt-3">
      <div class="flex items-center gap-1">
        <ColorPicker color={props.color} onColorChange={props.onColorChange} />
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
