// Builds the static DOM chrome for a note's wrapper, mounted once and
// never touched again outside of what it exposes below: the
// transparent drag-header overlay (see mountNote.ts's header comment
// for why it exists instead of drawing note content directly here),
// its Dismiss button, the loading spinner shown until the iframe
// reports its first measured content height, and the note's dark-mode
// color handling. Drag/resize gesture wiring itself lives in
// noteDragging.ts/noteResizing.ts -- this module only constructs and
// styles the DOM nodes.

import X from "lucide-solid/icons/x";
import { TITLE_ROW_HEIGHT_PX } from "../../lib/iframe-messages";

// Floor height for a single-line note: TITLE_ROW_HEIGHT_PX (header)
// plus one line of body text with its vertical padding (main's
// py-1.5 = 12px + one 14px/1.4 line ~= 20px). Without this, main's
// flex-1 stretches to fill whatever extra space a larger min-height
// forces, showing up as a blank second line under single-line notes.
const MIN_CONTENT_HEIGHT_PX = 32;

export interface NoteChrome {
  header: HTMLDivElement;
  // Removes the loading spinner once the iframe reports its first
  // measured content height (see noteIframeProtocol.ts's
  // NOTE_CONTENT_RESIZE_MESSAGE handling). A no-op once already
  // removed.
  removeLoadingOverlay: () => void;
  // Stops following the system color scheme -- call from onRemove.
  cleanup: () => void;
}

export function buildNoteChrome(params: {
  wrapper: HTMLElement;
  iframe: HTMLIFrameElement;
  initialWidthPx?: number;
  onDismiss: () => void;
}): NoteChrome {
  const { wrapper, iframe, initialWidthPx, onDismiss } = params;

  // Static properties only -- never changed again after mount. Width
  // in particular is also changed directly by the browser's own
  // native `resize: both` handle (see noteResizing.ts), which never
  // reports back through here, so it must stay outside the
  // store-driven effect in mountNote.ts entirely.
  Object.assign(wrapper.style, {
    width: initialWidthPx ? `${initialWidthPx}px` : "260px",
    minWidth: "160px",
    minHeight: `${TITLE_ROW_HEIGHT_PX + MIN_CONTENT_HEIGHT_PX}px`,
    resize: "both",
    overflow: "hidden",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.25)",
  });

  Object.assign(iframe.style, {
    border: "none",
    position: "absolute",
    top: "0",
    left: "0",
    width: "100%",
    height: "100%",
  });

  // Transparent overlay pinned to the title row that NoteContent.tsx
  // renders inside the iframe (see TITLE_ROW_HEIGHT_PX): it carries no
  // note text of its own -- see entrypoints/content/index.ts's header
  // comment for why -- but sits on top of the iframe so it can capture
  // the drag and the header double-click (relayed to the iframe as
  // START_EDIT_TITLE_MESSAGE, see noteDragging.ts) while the title
  // text shows through from underneath. It's set pointer-events:none
  // while editing so clicks reach the title input inside the iframe
  // instead (see noteIframeProtocol.ts's NOTE_EDITING_MESSAGE
  // handling).
  const header = document.createElement("div");
  Object.assign(header.style, {
    position: "absolute",
    top: "0",
    left: "0",
    right: "0",
    height: `${TITLE_ROW_HEIGHT_PX}px`,
    display: "flex",
    alignItems: "center",
    padding: "0 8px",
    boxSizing: "border-box",
    cursor: "grab",
    zIndex: "1",
  });

  // pointerEvents "none" so clicks (e.g. Dismiss) pass through to the
  // header underneath while this is still showing.
  const loadingOverlay = document.createElement("div");
  Object.assign(loadingOverlay.style, {
    position: "absolute",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    zIndex: "2",
  });
  const spinner = document.createElement("div");
  Object.assign(spinner.style, {
    width: "24px",
    height: "24px",
    borderRadius: "9999px",
    borderStyle: "solid",
    borderWidth: "4px",
  });
  spinner.animate(
    [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
    { duration: 800, iterations: Infinity, easing: "linear" },
  );
  loadingOverlay.append(spinner);
  wrapper.append(loadingOverlay);

  // The Dismiss icon (X) and the loading spinner both use fixed colors
  // instead of currentColor, since this wrapper is plain DOM on the
  // host page, not a Shadow DOM -- it has no access to the
  // --note-text variable from assets/theme.css. Set both here,
  // matching theme.css's palette, so they follow the system color
  // scheme instead of staying stuck at the host page's default colors.
  const darkModeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const applyThemeColors = () => {
    const dark = darkModeQuery.matches;
    header.style.color = dark ? "#f5efc9" : "#3a3520";
    spinner.style.borderColor = dark ? "#404040" : "#e5e5e5";
    spinner.style.borderTopColor = dark ? "#d4d4d4" : "#737373";
  };
  applyThemeColors();
  darkModeQuery.addEventListener("change", applyThemeColors);

  const dismissBtn = document.createElement("button");
  dismissBtn.type = "button";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  Object.assign(dismissBtn.style, {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    border: "none",
    background: "transparent",
    borderRadius: "4px",
    cursor: "pointer",
    font: "inherit",
    lineHeight: "1",
    // Bigger touch target so the button doesn't look cramped now
    // that the header row is taller (TITLE_ROW_HEIGHT_PX).
    padding: "6px 8px",
    // Stays clickable even while the header above is
    // pointer-events:none during editing -- a child's own
    // pointer-events setting overrides its parent's.
    pointerEvents: "auto",
    // Pins this button to the header's right edge. It's this
    // header's only button now -- the pin toggle lives in the footer
    // instead (see NoteFooter.tsx) -- so marginLeft: auto alone is
    // enough to push it there.
    marginLeft: "auto",
  });
  // Solid components return a real DOM node when called directly (no
  // JSX/render() needed here), same icon as old-arch used.
  dismissBtn.appendChild(X({ size: 16 }) as unknown as Node);
  dismissBtn.addEventListener("mouseenter", () => {
    dismissBtn.style.background = "rgba(127, 127, 127, 0.35)";
  });
  dismissBtn.addEventListener("mouseleave", () => {
    dismissBtn.style.background = "transparent";
  });
  dismissBtn.addEventListener("click", onDismiss);
  header.append(dismissBtn);
  wrapper.append(header);

  let loadingOverlayRemoved = false;
  const removeLoadingOverlay = () => {
    if (loadingOverlayRemoved) return;
    loadingOverlayRemoved = true;
    loadingOverlay.remove();
  };

  return {
    header,
    removeLoadingOverlay,
    cleanup: () =>
      darkModeQuery.removeEventListener("change", applyThemeColors),
  };
}
