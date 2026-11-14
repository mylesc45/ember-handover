import type { RawSpec } from "@ember-handover/bridge";
import type { Token, TokenSet } from "../src/index.js";

const t = (p: Partial<Token> & Pick<Token, "name" | "kind">): Token => ({ value: "", source: { file: "src/app.css", line: 1 }, ...p });

export const TOKENS: TokenSet = {
  system: "tailwind-v4",
  sources: ["src/app.css"],
  spacingBase: 4,
  breakpoints: [{ name: "md", px: 768 }],
  tokens: [
    t({ name: "white", kind: "color", hex: "#ffffff", utility: "white", cssVar: "--color-white" }),
    t({ name: "zinc-200", kind: "color", hex: "#e4e4e7", utility: "zinc-200", cssVar: "--color-zinc-200" }),
    t({ name: "zinc-900", kind: "color", hex: "#18181b", utility: "zinc-900", cssVar: "--color-zinc-900" }),
    t({ name: "xl", kind: "radius", px: 12, utility: "rounded-xl", cssVar: "--radius-xl" }),
    t({ name: "base", kind: "fontSize", px: 16, utility: "text-base", cssVar: "--text-base" }),
    t({ name: "semibold", kind: "fontWeight", value: "600", utility: "font-semibold", cssVar: "--font-weight-semibold" }),
    t({ name: "sans", kind: "fontFamily", value: "Inter, sans-serif", utility: "font-sans", cssVar: "--font-sans" }),
  ],
};

export const RAW: RawSpec = {
  path: "html:nth-child(1) > body:nth-child(2) > div:nth-child(1)",
  tag: "div",
  id: "",
  testid: "plan-pro",
  classes: "card pro",
  text: "Pro",
  ancestors: [
    { tag: "section", id: "plans", testid: "" },
    { tag: "body", id: "", testid: "" },
  ],
  rect: { x: 10, y: 20, width: 320, height: 412 },
  box: { margin: [0, 0, 16, 0], border: [1, 1, 1, 1], padding: [24, 24, 24, 24], borderStyle: "solid" },
  layout: {
    display: "flex",
    position: "static",
    boxSizing: "border-box",
    flexDirection: "column",
    flexWrap: "nowrap",
    justifyContent: "normal",
    alignItems: "center",
    rowGap: 16,
    columnGap: 16,
    gridTemplateColumns: "none",
    gridTemplateRows: "none",
    parentDisplay: "grid",
  },
  typography: {
    family: '"Inter", sans-serif',
    rendered: "Inter",
    size: 16,
    weight: 600,
    lineHeight: 24,
    letterSpacing: null,
    textAlign: "start",
    textTransform: "none",
    fontStyle: "normal",
  },
  colors: {
    text: "rgb(24, 24, 27)",
    background: "rgb(255, 255, 255)",
    border: ["rgb(228, 228, 231)", "rgb(228, 228, 231)", "rgb(228, 228, 231)", "rgb(228, 228, 231)"],
  },
  effects: {
    radius: [14, 14, 14, 14],
    shadow: "none",
    opacity: 1,
    transition: "all 0s ease 0s",
    transform: "none",
  },
  a11y: { role: "generic", name: "", backgrounds: ["rgb(255, 255, 255)"] },
  live: { hover: false, focus: false, active: false },
};
