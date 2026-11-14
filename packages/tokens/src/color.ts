/**
 * Colour parsing and conversion, following the CSS Color 4 sample code so that our
 * numbers match what Chrome computes and paints. No dependencies; browser-safe.
 */

/** sRGB channels 0..1 (may lie outside 0..1 for wide-gamut input) plus alpha 0..1. */
export interface Color {
  r: number;
  g: number;
  b: number;
  alpha: number;
}
type Vec3 = [number, number, number];
type Mat3 = [Vec3, Vec3, Vec3];

const mul = (m: Mat3, v: Vec3): Vec3 => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];

// --- transfer functions ---------------------------------------------------
const toLinear = (c: number) => {
  const a = Math.abs(c);
  return a <= 0.04045 ? c / 12.92 : Math.sign(c) * ((a + 0.055) / 1.055) ** 2.4;
};
const toGamma = (c: number) => {
  const a = Math.abs(c);
  return a > 0.0031308 ? Math.sign(c) * (1.055 * a ** (1 / 2.4) - 0.055) : 12.92 * c;
};

// --- matrices (CSS Color 4) ---------------------------------------------------
const LIN_SRGB_TO_XYZ: Mat3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053723],
];
const XYZ_TO_LIN_SRGB: Mat3 = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const LIN_P3_TO_XYZ: Mat3 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const D50_TO_D65: Mat3 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const D65_TO_D50: Mat3 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const XYZ_TO_LMS: Mat3 = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.929286861586343, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB: Mat3 = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const OKLAB_TO_LMS: Mat3 = [
  [1.0, 0.3963377773761749, 0.2158037573099136],
  [1.0, -0.1055613458156586, -0.0638541728258133],
  [1.0, -0.0894841775298119, -1.2914855480194092],
];
const LMS_TO_XYZ: Mat3 = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.112286803280317, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const KAPPA = 24389 / 27;
const EPSILON = 216 / 24389;

// --- space conversions -------------------------------------------------------
const xyz65ToSrgb = (xyz: Vec3): Vec3 => mul(XYZ_TO_LIN_SRGB, xyz).map(toGamma) as Vec3;
const srgbToXyz65 = (rgb: Vec3): Vec3 => mul(LIN_SRGB_TO_XYZ, rgb.map(toLinear) as Vec3);

function oklabToXyz65(lab: Vec3): Vec3 {
  return mul(LMS_TO_XYZ, mul(OKLAB_TO_LMS, lab).map((c) => c ** 3) as Vec3);
}
function xyz65ToOklab(xyz: Vec3): Vec3 {
  return mul(LMS_TO_OKLAB, mul(XYZ_TO_LMS, xyz).map(Math.cbrt) as Vec3);
}
function labToXyz50([L, a, b]: Vec3): Vec3 {
  const f1 = (L + 16) / 116;
  const f0 = a / 500 + f1;
  const f2 = f1 - b / 200;
  const x = f0 ** 3 > EPSILON ? f0 ** 3 : (116 * f0 - 16) / KAPPA;
  const y = L > KAPPA * EPSILON ? ((L + 16) / 116) ** 3 : L / KAPPA;
  const z = f2 ** 3 > EPSILON ? f2 ** 3 : (116 * f2 - 16) / KAPPA;
  return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]];
}
function xyz50ToLab(xyz: Vec3): Vec3 {
  const g = (t: number) => (t > EPSILON ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const f: Vec3 = [g(xyz[0] / D50_WHITE[0]), g(xyz[1] / D50_WHITE[1]), g(xyz[2] / D50_WHITE[2])];
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}
const polar = (l: number, c: number, h: number): Vec3 => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];

const fromRgb = ([r, g, b]: Vec3, alpha: number): Color => ({ r, g, b, alpha });

export function toLab(c: Color): Vec3 {
  return xyz50ToLab(mul(D65_TO_D50, srgbToXyz65([c.r, c.g, c.b])));
}
export function toOklab(c: Color): Vec3 {
  return xyz65ToOklab(srgbToXyz65([c.r, c.g, c.b]));
}

// --- parsing -----------------------------------------------------------------
const NAMED: Record<string, string> = {
  aliceblue: "f0f8ff", antiquewhite: "faebd7", aqua: "00ffff", aquamarine: "7fffd4", azure: "f0ffff", beige: "f5f5dc",
  bisque: "ffe4c4", black: "000000", blanchedalmond: "ffebcd", blue: "0000ff", blueviolet: "8a2be2", brown: "a52a2a",
  burlywood: "deb887", cadetblue: "5f9ea0", chartreuse: "7fff00", chocolate: "d2691e", coral: "ff7f50",
  cornflowerblue: "6495ed", cornsilk: "fff8dc", crimson: "dc143c", cyan: "00ffff", darkblue: "00008b", darkcyan: "008b8b",
  darkgoldenrod: "b8860b", darkgray: "a9a9a9", darkgreen: "006400", darkgrey: "a9a9a9", darkkhaki: "bdb76b",
  darkmagenta: "8b008b", darkolivegreen: "556b2f", darkorange: "ff8c00", darkorchid: "9932cc", darkred: "8b0000",
  darksalmon: "e9967a", darkseagreen: "8fbc8f", darkslateblue: "483d8b", darkslategray: "2f4f4f", darkslategrey: "2f4f4f",
  darkturquoise: "00ced1", darkviolet: "9400d3", deeppink: "ff1493", deepskyblue: "00bfff", dimgray: "696969",
  dimgrey: "696969", dodgerblue: "1e90ff", firebrick: "b22222", floralwhite: "fffaf0", forestgreen: "228b22",
  fuchsia: "ff00ff", gainsboro: "dcdcdc", ghostwhite: "f8f8ff", gold: "ffd700", goldenrod: "daa520", gray: "808080",
  green: "008000", greenyellow: "adff2f", grey: "808080", honeydew: "f0fff0", hotpink: "ff69b4", indianred: "cd5c5c",
  indigo: "4b0082", ivory: "fffff0", khaki: "f0e68c", lavender: "e6e6fa", lavenderblush: "fff0f5", lawngreen: "7cfc00",
  lemonchiffon: "fffacd", lightblue: "add8e6", lightcoral: "f08080", lightcyan: "e0ffff", lightgoldenrodyellow: "fafad2",
  lightgray: "d3d3d3", lightgreen: "90ee90", lightgrey: "d3d3d3", lightpink: "ffb6c1", lightsalmon: "ffa07a",
  lightseagreen: "20b2aa", lightskyblue: "87cefa", lightslategray: "778899", lightslategrey: "778899",
  lightsteelblue: "b0c4de", lightyellow: "ffffe0", lime: "00ff00", limegreen: "32cd32", linen: "faf0e6", magenta: "ff00ff",
  maroon: "800000", mediumaquamarine: "66cdaa", mediumblue: "0000cd", mediumorchid: "ba55d3", mediumpurple: "9370db",
  mediumseagreen: "3cb371", mediumslateblue: "7b68ee", mediumspringgreen: "00fa9a", mediumturquoise: "48d1cc",
  mediumvioletred: "c71585", midnightblue: "191970", mintcream: "f5fffa", mistyrose: "ffe4e1", moccasin: "ffe4b5",
  navajowhite: "ffdead", navy: "000080", oldlace: "fdf5e6", olive: "808000", olivedrab: "6b8e23", orange: "ffa500",
  orangered: "ff4500", orchid: "da70d6", palegoldenrod: "eee8aa", palegreen: "98fb98", paleturquoise: "afeeee",
  palevioletred: "db7093", papayawhip: "ffefd5", peachpuff: "ffdab9", peru: "cd853f", pink: "ffc0cb", plum: "dda0dd",
  powderblue: "b0e0e6", purple: "800080", rebeccapurple: "663399", red: "ff0000", rosybrown: "bc8f8f",
  royalblue: "4169e1", saddlebrown: "8b4513", salmon: "fa8072", sandybrown: "f4a460", seagreen: "2e8b57",
  seashell: "fff5ee", sienna: "a0522d", silver: "c0c0c0", skyblue: "87ceeb", slateblue: "6a5acd", slategray: "708090",
  slategrey: "708090", snow: "fffafa", springgreen: "00ff7f", steelblue: "4682b4", tan: "d2b48c", teal: "008080",
  thistle: "d8bfd8", tomato: "ff6347", turquoise: "40e0d0", violet: "ee82ee", wheat: "f5deb3", white: "ffffff",
  whitesmoke: "f5f5f5", yellow: "ffff00", yellowgreen: "9acd32",
};

/** Parse one numeric component: plain, percentage (scaled by `pct`), or `none` (0). */
function num(token: string | undefined, pct = 1): number | null {
  if (token === undefined) return null;
  if (token === "none") return 0;
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|deg|rad|grad|turn)?$/i.exec(token);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]?.toLowerCase()) {
    case "%":
      return (v / 100) * pct;
    case "rad":
      return (v * 180) / Math.PI;
    case "grad":
      return v * 0.9;
    case "turn":
      return v * 360;
    default:
      return v;
  }
}

function alphaOf(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const a = num(token, 1);
  return a === null ? null : Math.min(1, Math.max(0, a));
}

function hex(s: string): Color | null {
  let h = /^#([0-9a-f]{3,8})$/i.exec(s)?.[1];
  if (!h || ![3, 4, 6, 8].includes(h.length)) return null;
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
  return { r: n(0), g: n(2), b: n(4), alpha: h.length === 8 ? n(6) : 1 };
}

/** Split `fn(a b c / d)` or legacy `fn(a, b, c, d)` into components and alpha. */
function args(body: string): { parts: string[]; alpha: string | undefined } | null {
  const t = body.trim();
  if (t.includes(",")) {
    const p = t.split(",").map((x) => x.trim());
    if (p.some((x) => x === "")) return null;
    return { parts: p.slice(0, 3), alpha: p[3] };
  }
  const [main, alpha, ...rest] = t.split("/").map((x) => x.trim());
  if (rest.length || main === undefined) return null;
  return { parts: main.split(/\s+/).filter(Boolean), alpha };
}

function hslToRgb(h: number, s: number, l: number): Vec3 {
  h = ((h % 360) + 360) % 360;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/**
 * Parse a CSS colour as authored or as computed by Chrome.
 * Returns null for anything we can't resolve on our own (var(), currentColor, gradients).
 */
export function parseColor(input: string): Color | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };
  if (s.startsWith("#")) return hex(s);
  if (Object.hasOwn(NAMED, s)) return hex(`#${NAMED[s]}`);
  const m = /^([a-z-]+)\((.*)\)$/s.exec(s);
  if (!m) return null;
  const [, fn, body] = m;
  const a = args(body ?? "");
  if (!a || a.parts.length !== (fn === "color" ? 4 : 3)) return null;
  const alpha = alphaOf(a.alpha);
  if (alpha === null) return null;
  const p = a.parts;

  switch (fn) {
    case "rgb":
    case "rgba": {
      const v = p.map((x) => {
        if (x.endsWith("%")) return num(x, 1);
        const n = num(x);
        return n === null ? null : n / 255;
      });
      if (v.some((x) => x === null)) return null;
      return fromRgb(v as Vec3, alpha);
    }
    case "hsl":
    case "hsla": {
      const h = num(p[0]);
      const pct = (x: string | undefined) => (x === undefined ? null : num(x.endsWith("%") || x === "none" ? x : `${x}%`, 1));
      const sat = pct(p[1]);
      const l = pct(p[2]);
      if (h === null || sat === null || l === null) return null;
      return fromRgb(hslToRgb(h, sat, l), alpha);
    }
    case "oklab":
    case "oklch": {
      const L = num(p[0], 1);
      const x = num(p[1], fn === "oklab" ? 0.4 : 0.4);
      const y = num(p[2], fn === "oklab" ? 0.4 : 1);
      if (L === null || x === null || y === null) return null;
      const lab: Vec3 = fn === "oklab" ? [L, x, y] : polar(L, x, y);
      return fromRgb(xyz65ToSrgb(oklabToXyz65(lab)), alpha);
    }
    case "lab":
    case "lch": {
      const L = num(p[0], 100);
      const x = num(p[1], fn === "lab" ? 125 : 150);
      const y = num(p[2], fn === "lab" ? 125 : 1);
      if (L === null || x === null || y === null) return null;
      const lab: Vec3 = fn === "lab" ? [L, x, y] : polar(L, x, y);
      return fromRgb(xyz65ToSrgb(mul(D50_TO_D65, labToXyz50(lab))), alpha);
    }
    case "color": {
      const space = p[0];
      const v = p.slice(1).map((x) => num(x, 1));
      if (v.some((x) => x === null)) return null;
      if (space === "srgb") return fromRgb(v as Vec3, alpha);
      if (space === "srgb-linear") return fromRgb((v as Vec3).map(toGamma) as Vec3, alpha);
      if (space === "display-p3") return fromRgb(xyz65ToSrgb(mul(LIN_P3_TO_XYZ, (v as Vec3).map(toLinear) as Vec3)), alpha);
      return null;
    }
    default:
      return null;
  }
}

// --- formatting ------------------------------------------------------------------
const byte = (c: number) => Math.round(Math.min(1, Math.max(0, c)) * 255);
const hex2 = (n: number) => n.toString(16).padStart(2, "0");

/** #rrggbb, or #rrggbbaa when translucent. Out-of-gamut channels are clipped. */
export function toHex(c: Color): string {
  const base = `#${hex2(byte(c.r))}${hex2(byte(c.g))}${hex2(byte(c.b))}`;
  return c.alpha < 1 ? base + hex2(Math.round(c.alpha * 255)) : base;
}

const round = (v: number, d: number) => {
  const r = Number(v.toFixed(d));
  return Object.is(r, -0) ? 0 : r;
};

export function formatOklch(c: Color): string {
  const [L, a, b] = toOklab(c);
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  const achromatic = C < 0.0005;
  const body = `${round(L * 100, 1)}% ${achromatic ? 0 : round(C, 3)} ${achromatic ? 0 : round(H, 2)}`;
  return c.alpha < 1 ? `oklch(${body} / ${round(c.alpha, 3)})` : `oklch(${body})`;
}

export function sameColor(a: Color, b: Color): boolean {
  return toHex(a) === toHex(b);
}

// --- comparison --------------------------------------------------------------------
/** Source-over compositing of `top` onto `bottom`. */
export function composite(top: Color, bottom: Color): Color {
  const a = top.alpha + bottom.alpha * (1 - top.alpha);
  if (a === 0) return { r: 0, g: 0, b: 0, alpha: 0 };
  const ch = (t: number, u: number) => (t * top.alpha + u * bottom.alpha * (1 - top.alpha)) / a;
  return { r: ch(top.r, bottom.r), g: ch(top.g, bottom.g), b: ch(top.b, bottom.b), alpha: a };
}

function luminance(c: Color): number {
  // WCAG 2.x relative luminance on 8-bit sRGB.
  const lin = (v: number) => {
    const s = byte(v) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG 2.2 contrast ratio. Translucent foregrounds are composited onto the background first. */
export function contrastRatio(fg: Color, bg: Color): number {
  const opaqueBg = bg.alpha < 1 ? composite(bg, { r: 1, g: 1, b: 1, alpha: 1 }) : bg;
  const f = fg.alpha < 1 ? composite(fg, opaqueBg) : fg;
  const [hi, lo] = [luminance(f), luminance(opaqueBg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** CIEDE2000 colour difference on CIELAB values. */
export function deltaE2000Lab([L1, a1, b1]: Vec3, [L2, a2, b2]: Vec3): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (b === 0 && a === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
    else hbp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

export function deltaE(a: Color, b: Color): number {
  return deltaE2000Lab(toLab(a), toLab(b));
}
