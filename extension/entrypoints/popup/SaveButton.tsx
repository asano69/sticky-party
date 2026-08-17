import { Button } from '@kobalte/core/button';
import CircleCheckBig from 'lucide-solid/icons/circle-check-big';
import { ICON_BTN } from './classes';

export type SaveStatus = 'idle' | 'saving' | 'success' | 'error';

// Shared submit button for popup forms (Home.tsx, Settings.tsx): a
// circle-check icon that spins while saving, then optionally settles
// into green (success) or a dark, blood-like red (error) depending on
// the outcome of whatever check the caller runs after saving. Callers
// that have no such check (e.g. Home.tsx) can just leave status at
// 'idle' once saving finishes, and the icon stays uncolored.
export default function SaveButton(props: { status: SaveStatus }) {
  return (
    <Button
      type="submit"
      class={ICON_BTN}
      disabled={props.status === 'saving'}
      aria-label="Save"
    >
      <CircleCheckBig
        size={20}
        class={
          props.status === 'saving'
            ? 'animate-spin'
            : props.status === 'success'
              ? 'text-green-600'
              : props.status === 'error'
                ? 'text-[#8b0000]'
                : ''
        }
      />
    </Button>
  );
}
