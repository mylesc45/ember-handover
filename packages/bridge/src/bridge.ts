/**
 * In-page bridge. Injected by the proxy as a deferred <script>.
 *
 * Rules (SPEC S4):
 * - Exposes no globals: everything lives in this module's closure.
 * - Writes to the DOM only to append its own host element; all UI (the overlay iframe and
 *   the box-model highlight) lives inside a *closed* shadow root.
 * - Accepts commands only from that iframe's window at the overlay origin, validated
 *   against the protocol schema.
 */
import { createHighlight } from "./highlight.js";
import { measure } from "./measure.js";
import { type BridgeEvent, type LayoutMode, MAX_TITLE, MAX_URL, type OverlayCommand, parseOverlayCommand } from "./protocol.js";

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

const POINTER_EVENTS = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu"];

function mount(url: URL) {
  const host = document.createElement("handoff-overlay");
  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent =
    ":host{all:initial!important;display:contents!important}iframe{position:fixed;z-index:2147483647;border:0;margin:0;padding:0;background:transparent;color-scheme:normal;display:block}";
  const frame = document.createElement("iframe");
  frame.title = "Handoff Dev Mode";
  frame.src = url.href;
  frame.setAttribute("allow", "clipboard-write");
  frame.setAttribute("style", LAYOUTS.pill);
  shadow.append(style, frame);
  const highlight = createHighlight(shadow);

  const origin = url.origin;
  const send = (evt: BridgeEvent) => frame.contentWindow?.postMessage(evt, origin);
  const page = (): BridgeEvent => ({
    v: 1,
    type: "page",
    url: location.href.slice(0, MAX_URL),
    title: document.title.slice(0, MAX_TITLE),
  });
  // Speak first so the overlay learns this page's origin without broadcasting.
  frame.addEventListener("load", () => send(page()));

  // --- inspect mode -----------------------------------------------------------------
  let inspecting = false;
  let hovered: Element | null = null;
  let pinned: Element | null = null;
  let lastSent = "";

  const ours = (t: EventTarget | null) => t === host || (t instanceof Node && host.contains(t));
  const sendSpec = (el: Element | null, isPinned: boolean, force = false) => {
    const evt: BridgeEvent = { v: 1, type: "spec", pinned: isPinned, spec: el ? measure(el) : null };
    const key = JSON.stringify(evt);
    if (!force && key === lastSent) return;
    lastSent = key;
    send(evt);
  };
  const redraw = () => highlight.draw(pinned ?? hovered, pinned !== null);
  const pin = (el: Element | null) => {
    pinned = el;
    redraw();
    sendSpec(el, el !== null, true);
  };

  let frameRequested = false;
  const onMove = (e: PointerEvent) => {
    if (!inspecting || ours(e.target)) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t === hovered) return;
    hovered = t;
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      highlight.draw(hovered, false);
      if (pinned) highlight.draw(pinned, true);
      if (!pinned) sendSpec(hovered, false);
    });
  };
  const onPointer = (e: Event) => {
    if (!inspecting || ours(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    // Pin when the pointer is released, at its position: disabled controls never receive
    // click, and measuring after release keeps :active (pressed) styles out of the spec.
    if (e.type === "pointerup" && e instanceof PointerEvent) {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      if (t && !ours(t)) setTimeout(() => pin(t), 0);
    }
  };
  const setInspect = (on: boolean) => {
    if (on === inspecting) return;
    inspecting = on;
    const method = on ? addEventListener : removeEventListener;
    method("pointermove", onMove as EventListener, true);
    for (const t of POINTER_EVENTS) method(t, onPointer, true);
    if (!on) {
      hovered = null;
      pinned = null;
      lastSent = "";
    }
    redraw();
  };

  const select = (cmd: Extract<OverlayCommand, { type: "select" }>) => {
    const from = pinned ?? hovered;
    if (cmd.to === "none") return pin(null);
    if (!from) return;
    if (cmd.to === "parent" && from.parentElement && from.parentElement !== document.documentElement) pin(from.parentElement);
    else if (cmd.to === "child" && from.firstElementChild) pin(from.firstElementChild);
    else if (cmd.to === "ancestor") {
      let e: Element | null = from;
      for (let i = 0; i <= cmd.index && e; i++) e = e.parentElement;
      if (e) pin(e);
    }
  };

  addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow || e.origin !== origin) return;
    const cmd = parseOverlayCommand(e.data);
    if (!cmd) return;
    if (cmd.type === "hello") send(page());
    else if (cmd.type === "layout") frame.setAttribute("style", LAYOUTS[cmd.mode]);
    else if (cmd.type === "inspect") setInspect(cmd.on);
    else if (cmd.type === "select") select(cmd);
    else if (cmd.type === "navigate") {
      const target = new URL(cmd.path, location.origin);
      if (target.origin === location.origin && target.href !== location.href) location.assign(target.href);
    }
  });

  addEventListener(
    "keydown",
    (e) => {
      if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditable(e.target)) return;
      if (inspecting && pinned && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        select({ v: 1, type: "select", to: e.key === "ArrowUp" ? "parent" : "child" });
        return;
      }
      const k = e.key.toLowerCase();
      // Forwarded only; never prevented, so the app's own shortcuts keep working.
      if (k === "d") send({ v: 1, type: "key", key: "toggle" });
      else if (k === "f") send({ v: 1, type: "key", key: "flows" });
      else if (k === "c") send({ v: 1, type: "key", key: "changes" });
      else if (k === "i") send({ v: 1, type: "key", key: "inspect" });
      else if (e.key === "Escape") {
        if (inspecting && pinned) pin(null);
        else send({ v: 1, type: "key", key: "escape" });
      }
    },
    true,
  );

  addEventListener("scroll", redraw, { capture: true, passive: true });
  addEventListener("resize", redraw, { passive: true });

  // SPA navigation, title changes, and live values after HMR: poll, never patch page globals.
  let last = "";
  setInterval(() => {
    const p = page();
    const key = p.type === "page" ? p.url + "\u0000" + p.title : "";
    if (key !== last) {
      last = key;
      send(p);
    }
    if (inspecting && pinned) {
      if (!pinned.isConnected) pin(null);
      else {
        redraw();
        sendSpec(pinned, true);
      }
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
