/**
 * In-page bridge. Injected by the proxy as a deferred <script>.
 *
 * Rules (SPEC S4):
 * - Exposes no globals: everything lives in this module's closure.
 * - Writes to the DOM only to append its own host element; all UI lives in a
 *   cross-origin iframe inside a *closed* shadow root.
 * - Accepts commands only from that iframe's window at the overlay origin,
 *   validated against the protocol schema.
 */
import { parseOverlayCommand, type BridgeEvent, type LayoutMode, MAX_TITLE, MAX_URL } from "./protocol.js";

const script = document.currentScript as HTMLScriptElement | null;
const overlayUrl = parseOverlayUrl(script?.getAttribute("data-handoff-overlay"));

function parseOverlayUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    // The overlay must be on a loopback http origin.
    if (u.protocol !== "http:" || u.hostname !== "127.0.0.1") return null;
    return u;
  } catch {
    return null;
  }
}

const LAYOUTS: Record<LayoutMode, string> = {
  pill: "bottom:16px;right:16px;width:136px;height:32px;border-radius:16px;box-shadow:0 4px 16px rgb(15 20 32 / .35);",
  panel: "top:0;right:0;width:360px;height:100vh;height:100dvh;border-radius:0;box-shadow:0 12px 32px rgb(15 20 32 / .45);",
};

function mount(url: URL) {
  const host = document.createElement("handoff-overlay");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = ":host{all:initial!important;display:contents!important}iframe{position:fixed;z-index:2147483647;border:0;margin:0;padding:0;background:transparent;color-scheme:normal;display:block}";
  const frame = document.createElement("iframe");
  frame.title = "Handoff Dev Mode";
  frame.src = url.href;
  frame.setAttribute("allow", "clipboard-write");
  frame.setAttribute("style", LAYOUTS.pill);
  shadow.append(style, frame);
  // Speak first so the overlay learns this page's origin without broadcasting.
  frame.addEventListener("load", () => send(page()));

  const origin = url.origin;
  const send = (evt: BridgeEvent) => frame.contentWindow?.postMessage(evt, origin);
  const page = (): BridgeEvent => ({
    v: 1,
    type: "page",
    url: location.href.slice(0, MAX_URL),
    title: document.title.slice(0, MAX_TITLE),
  });

  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.origin !== origin) return;
    const cmd = parseOverlayCommand(e.data);
    if (!cmd) return;
    if (cmd.type === "hello") send(page());
    else if (cmd.type === "layout") frame.setAttribute("style", LAYOUTS[cmd.mode]);
  });

  addEventListener(
    "keydown",
    (e) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (e.key === "d" || e.key === "D") send({ v: 1, type: "key", key: "toggle" });
      else if (e.key === "Escape") send({ v: 1, type: "key", key: "escape" });
    },
    true,
  );

  // SPA navigation and title changes: poll instead of patching history (no page globals touched).
  let last = "";
  setInterval(() => {
    const p = page();
    const key = p.type === "page" ? p.url + "\u0000" + p.title : "";
    if (key !== last) {
      last = key;
      send(p);
    }
  }, 500);

  const attach = () => {
    if (!host.isConnected && document.body) document.body.append(host);
  };
  attach();
  // Frameworks that re-render <body> can drop our host; put it back.
  new MutationObserver(attach).observe(document.documentElement, { childList: true, subtree: false });
  new MutationObserver(attach).observe(document.body, { childList: true });
}

function isEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

if (overlayUrl && window.top === window) {
  if (document.body) mount(overlayUrl);
  else addEventListener("DOMContentLoaded", () => mount(overlayUrl), { once: true });
}
