import { parseBridgeEvent, type BridgeEvent, type OverlayCommand } from "@ember-handover/bridge";

/**
 * The overlay's side of the postMessage channel.
 * Events from the page are *untrusted data*: any script in the app page can forge
 * them, so they may only change what the overlay displays, never what it does
 * with the API (SPEC S4).
 */
export function createChannel(appOrigins: string[], onEvent: (e: BridgeEvent) => void) {
  let parentOrigin: string | null = null;
  const parent = window.parent;
  // The bridge speaks first (when this frame loads). Until then we don't know which
  // loopback name the page uses, so commands wait here instead of being broadcast.
  const queue: OverlayCommand[] = [];

  addEventListener("message", (e) => {
    if (e.source !== parent || !appOrigins.includes(e.origin)) return;
    const evt = parseBridgeEvent(e.data);
    if (!evt) return;
    if (parentOrigin === null) {
      parentOrigin = e.origin;
      for (const cmd of queue.splice(0)) parent.postMessage(cmd, parentOrigin);
    }
    onEvent(evt);
  });

  const send = (cmd: OverlayCommand) => {
    if (parentOrigin === null) queue.push(cmd);
    else parent.postMessage(cmd, parentOrigin);
  };
  return { send };
}
