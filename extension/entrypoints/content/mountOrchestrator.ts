// Mounts the realtime-orchestrator iframe: a headless (no visible UI)
// extension page that subscribes to PocketBase realtime for the page's
// current target and relays events back to this document (create/delete)
// or directly to the matching note's own iframe via a target-scoped
// BroadcastChannel (update) -- see lib/realtime-messages.ts for the
// protocol and docs/realtime-sync.md for why this exists as a separate
// iframe from each note's annotation-iframe.

import {
  INIT_ORCHESTRATOR_MESSAGE,
  ORCHESTRATOR_READY_MESSAGE,
  type InitOrchestratorMessage,
} from "../../lib/realtime-messages";

export const ORCHESTRATOR_PAGE = "/realtime-orchestrator.html";

export interface MountOrchestratorDeps {
  orchestratorOrigin: string;
}

export function mountOrchestrator(
  ctx: InstanceType<typeof ContentScriptContext>,
  deps: MountOrchestratorDeps,
) {
  let contentWindow: Window | null = null;
  // Whether the orchestrator iframe has announced itself ready to
  // receive messages (see NOTE_READY_MESSAGE in mountNote.ts for the
  // same race this avoids). sendInit() before ready just remembers the
  // target and sends it once ready arrives.
  let ready = false;
  let pendingTarget: string | undefined;
  let onMessage: ((e: MessageEvent) => void) | undefined;

  const ui = createIframeUi(ctx, {
    page: ORCHESTRATOR_PAGE,
    position: "inline",
    anchor: "html",
    onMount: (wrapper, iframe) => {
      // Headless: never shown, so it must take up no visible space and
      // never intercept clicks meant for the page.
      wrapper.style.display = "none";
      contentWindow = iframe.contentWindow;

      onMessage = (e) => {
        if (e.source !== contentWindow) return;
        if (e.data?.type === ORCHESTRATOR_READY_MESSAGE) {
          ready = true;
          if (pendingTarget) sendInit(pendingTarget);
        }
      };
      window.addEventListener("message", onMessage);
    },
    onRemove: () => {
      if (onMessage) window.removeEventListener("message", onMessage);
      contentWindow = null;
      ready = false;
    },
  });

  function sendInit(target: string) {
    pendingTarget = target;
    if (!ready) return;
    contentWindow?.postMessage(
      {
        type: INIT_ORCHESTRATOR_MESSAGE,
        target,
      } satisfies InitOrchestratorMessage,
      deps.orchestratorOrigin,
    );
  }

  const getWindow = () => contentWindow;

  return { ui, sendInit, getWindow };
}
