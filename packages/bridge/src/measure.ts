/**
 * Layer 1 measurement: read-only, from the rendered DOM (SPEC → "Truth from the browser").
 * Runs in the app page (bridge) and in headless Chromium (states, breakpoints).
 */
import type { Quad, RawSpec } from "./protocol.js";
import { MAX_ANCESTORS } from "./protocol.js";

const px = (v: string) => Number.parseFloat(v) || 0;
const pxOrNull = (v: string) => (v === "normal" || v === "" || v === "none" ? null : Number.parseFloat(v));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const sides = (cs: CSSStyleDeclaration, prefix: string, suffix = ""): Quad => [
  px(cs.getPropertyValue(`${prefix}-top${suffix}`)),
  px(cs.getPropertyValue(`${prefix}-right${suffix}`)),
  px(cs.getPropertyValue(`${prefix}-bottom${suffix}`)),
  px(cs.getPropertyValue(`${prefix}-left${suffix}`)),
];

/** Strict, unambiguous path from <html>: `html:nth-child(1) > body:nth-child(2) > …`. */
export function pathOf(el: Element): string {
  const parts: string[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const i = e.parentElement ? Array.prototype.indexOf.call(e.parentElement.children, e) + 1 : 1;
    parts.unshift(`${e.localName}:nth-child(${i})`);
  }
  return parts.join(" > ");
}

function radius(cs: CSSStyleDeclaration, width: number): Quad {
  const corner = (c: string) => {
    const v = cs.getPropertyValue(`border-${c}-radius`).split(" ")[0] ?? "0";
    return v.endsWith("%") ? (Number.parseFloat(v) / 100) * width : px(v);
  };
  return [corner("top-left"), corner("top-right"), corner("bottom-right"), corner("bottom-left")];
}

// --- fonts ------------------------------------------------------------------------
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|emoji|math|fangsong|ui-[a-z-]+|-apple-system|blinkmacsystemfont)$/i;
const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, "");
let canvas: CanvasRenderingContext2D | null = null;

function installed(family: string): boolean {
  canvas ??= document.createElement("canvas").getContext("2d");
  if (!canvas) return false;
  const text = "mmmmmmmmmmlli1WQ@#";
  for (const base of ["monospace", "serif", "sans-serif"]) {
    canvas.font = `72px ${base}`;
    const w0 = canvas.measureText(text).width;
    canvas.font = `72px "${family}", ${base}`;
    if (canvas.measureText(text).width !== w0) return true;
  }
  return false;
}

/** The face actually rendering: first loaded web font in the stack, or an installed system font. */
function renderedFamily(stack: string): string | null {
  const faces = new Map<string, FontFaceLoadStatus[]>();
  document.fonts.forEach((f) => {
    const k = unquote(f.family).toLowerCase();
    faces.set(k, [...(faces.get(k) ?? []), f.status]);
  });
  for (const raw of stack.split(",")) {
    const fam = unquote(raw);
    if (!fam) continue;
    if (GENERIC.test(fam)) return null; // the platform picks; we can't name it honestly
    const statuses = faces.get(fam.toLowerCase());
    if (statuses) {
      if (statuses.includes("loaded")) return fam;
      continue; // declared web font that isn't loaded: the browser falls back
    }
    if (installed(fam)) return fam;
  }
  return null;
}

// --- accessibility -------------------------------------------------------------------
const IMPLICIT: Record<string, string> = {
  a: "link",
  article: "article",
  aside: "complementary",
  button: "button",
  code: "code",
  dialog: "dialog",
  div: "generic",
  em: "emphasis",
  footer: "contentinfo",
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  header: "banner",
  hr: "separator",
  img: "image",
  li: "listitem",
  main: "main",
  nav: "navigation",
  ol: "list",
  p: "paragraph",
  section: "region",
  select: "combobox",
  small: "generic",
  span: "generic",
  strong: "strong",
  table: "table",
  textarea: "textbox",
  ul: "list",
  b: "generic",
  i: "generic",
  u: "generic",
};
const INPUT_ROLES: Record<string, string> = {
  button: "button",
  checkbox: "checkbox",
  email: "textbox",
  number: "spinbutton",
  password: "textbox",
  radio: "radio",
  range: "slider",
  reset: "button",
  search: "searchbox",
  submit: "button",
  tel: "textbox",
  text: "textbox",
  url: "textbox",
};
const NAME_FROM_CONTENT = new Set(["button", "link", "heading", "tab", "checkbox", "radio", "option", "menuitem", "cell", "columnheader", "rowheader", "tooltip", "treeitem", "switch"]);

export function roleOf(el: Element): string {
  const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = el.localName;
  if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
  if (tag === "img") return el.getAttribute("alt") === "" ? "none" : "image";
  if (tag === "input") return INPUT_ROLES[(el as HTMLInputElement).type] ?? "textbox";
  return IMPLICIT[tag] ?? "generic";
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function textOf(node: Node, skip?: Element): string {
  let out = "";
  node.childNodes.forEach((c) => {
    if (c === skip) return;
    if (c.nodeType === Node.TEXT_NODE) out += c.textContent ?? "";
    else if (c instanceof Element) {
      if (c instanceof HTMLElement && c.hidden) return;
      const label = c.getAttribute("aria-label");
      out += label ?? (c.localName === "img" ? (c.getAttribute("alt") ?? "") : textOf(c, skip));
    }
  });
  return out;
}

export function nameOf(el: Element, role: string): string {
  const ids = el.getAttribute("aria-labelledby");
  if (ids) {
    const t = ids
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((x): x is HTMLElement => !!x)
      .map((x) => squash(textOf(x)))
      .join(" ");
    if (t) return t;
  }
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return squash(aria);
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    if (el instanceof HTMLInputElement && ["button", "submit", "reset"].includes(el.type)) return el.value || (el.type === "submit" ? "Submit" : "");
    const labels = el.labels ? [...el.labels] : [];
    const t = labels.map((l) => squash(textOf(l, el))).join(" ");
    if (t) return t;
  }
  if (el.localName === "img") return squash(el.getAttribute("alt") ?? "");
  if (NAME_FROM_CONTENT.has(role)) {
    const t = squash(textOf(el));
    if (t) return t;
  }
  return squash(el.getAttribute("title") ?? "");
}

function backgrounds(el: Element): string[] {
  const out: string[] = [];
  for (let e: Element | null = el; e && out.length < 32; e = e.parentElement) {
    const bg = getComputedStyle(e).backgroundColor;
    if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
    out.push(bg);
    if (!/^rgba\(|\/\s*[\d.]+%?\s*\)$/.test(bg)) break; // opaque: nothing behind it shows
  }
  return out;
}

/** `transition` built from its longhands, one `property duration timing delay` per item. */
function transition(cs: CSSStyleDeclaration): string {
  const list = (v: string) => v.split(/,(?![^(]*\))/).map((x) => x.trim());
  const prop = list(cs.transitionProperty);
  const dur = list(cs.transitionDuration);
  const ease = list(cs.transitionTimingFunction);
  const delay = list(cs.transitionDelay);
  return prop.map((p, i) => `${p} ${dur[i % dur.length]} ${ease[i % ease.length]} ${delay[i % delay.length]}`).join(", ");
}

const matches = (el: Element, sel: string) => {
  try {
    return el.matches(sel);
  } catch {
    return false;
  }
};

// --- measure -----------------------------------------------------------------------------
export function measure(el: Element): RawSpec {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
  const role = roleOf(el);
  const ancestors: RawSpec["ancestors"] = [];
  for (let e = el.parentElement; e && ancestors.length < MAX_ANCESTORS; e = e.parentElement) {
    ancestors.push({ tag: e.localName, id: clip(e.id, 256), testid: clip(e.getAttribute("data-testid") ?? "", 256) });
  }
  return {
    path: clip(pathOf(el), 4096),
    tag: el.localName,
    id: clip(el.id, 256),
    testid: clip(el.getAttribute("data-testid") ?? "", 256),
    classes: clip(typeof el.className === "string" ? el.className : (el.getAttribute("class") ?? ""), 2048),
    text: clip(squash(el.textContent ?? ""), 200),
    ancestors,
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    box: {
      margin: sides(cs, "margin"),
      border: sides(cs, "border", "-width"),
      padding: sides(cs, "padding"),
      borderStyle: cs.borderTopStyle,
    },
    layout: {
      display: cs.display,
      position: cs.position,
      boxSizing: cs.boxSizing,
      flexDirection: cs.flexDirection,
      flexWrap: cs.flexWrap,
      justifyContent: cs.justifyContent,
      alignItems: cs.alignItems,
      rowGap: pxOrNull(cs.rowGap),
      columnGap: pxOrNull(cs.columnGap),
      gridTemplateColumns: clip(cs.gridTemplateColumns, 1024),
      gridTemplateRows: clip(cs.gridTemplateRows, 1024),
      parentDisplay: parent?.display ?? "",
    },
    typography: {
      family: clip(cs.fontFamily, 1024),
      rendered: renderedFamily(cs.fontFamily),
      size: px(cs.fontSize),
      weight: Number(cs.fontWeight),
      lineHeight: pxOrNull(cs.lineHeight),
      letterSpacing: pxOrNull(cs.letterSpacing),
      textAlign: cs.textAlign,
      textTransform: cs.textTransform,
      fontStyle: cs.fontStyle,
    },
    colors: {
      text: cs.color,
      background: cs.backgroundColor,
      border: [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor],
    },
    effects: {
      radius: radius(cs, r.width),
      shadow: clip(cs.boxShadow, 2048),
      opacity: Number(cs.opacity),
      transition: clip(transition(cs), 2048),
      transform: clip(cs.transform, 1024),
    },
    a11y: { role, name: clip(nameOf(el, role), 1024), backgrounds: backgrounds(el) },
    live: { hover: matches(el, ":hover"), focus: matches(el, ":focus"), active: matches(el, ":active") },
  };
}
