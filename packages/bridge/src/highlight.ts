/**
 * Box-model highlight drawn inside the bridge's closed shadow root (never in the app's DOM).
 * SPEC → Selection outline: 2 px coral with 4 px corner handles; padding tinted coral 15%,
 * margin tinted peach 15%.
 */
const CORAL = "246 70 104";
const PEACH = "254 150 119";

export interface Highlight {
  draw(el: Element | null, pinned: boolean): void;
}

export function createHighlight(root: ShadowRoot): Highlight {
  const layer = document.createElement("div");
  layer.setAttribute("style", "position:fixed;inset:0;pointer-events:none;z-index:2147483646;display:none");
  const box = (style: string) => {
    const d = document.createElement("div");
    d.setAttribute("style", `position:fixed;box-sizing:border-box;pointer-events:none;${style}`);
    layer.append(d);
    return d;
  };
  const margin = box(`border-style:solid;border-color:rgb(${PEACH} / .15)`);
  const padding = box(`border-style:solid;border-color:rgb(${CORAL} / .15)`);
  const outline = box(`outline:2px solid rgb(${CORAL});outline-offset:-1px`);
  const handles = [0, 1, 2, 3].map(() => box(`width:4px;height:4px;background:rgb(${CORAL})`));
  root.append(layer);

  const place = (d: HTMLElement, x: number, y: number, w: number, h: number, bw = "0") => {
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    d.style.width = `${Math.max(0, w)}px`;
    d.style.height = `${Math.max(0, h)}px`;
    d.style.borderWidth = bw;
  };

  return {
    draw(el, pinned) {
      if (!el || !el.isConnected) {
        layer.style.display = "none";
        return;
      }
      layer.style.display = "block";
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const n = (p: string) => Number.parseFloat(cs.getPropertyValue(p)) || 0;
      const four = (f: (side: string) => number) => [f("top"), f("right"), f("bottom"), f("left")] as const;
      const [mt, mr, mb, ml] = four((s) => Math.max(0, n(`margin-${s}`)));
      const [bt, br, bb, bl] = four((s) => n(`border-${s}-width`));
      const [pt, pr, pb, pl] = four((s) => n(`padding-${s}`));
      place(margin, r.left - ml, r.top - mt, r.width + ml + mr, r.height + mt + mb, `${mt}px ${mr}px ${mb}px ${ml}px`);
      place(padding, r.left + bl, r.top + bt, r.width - bl - br, r.height - bt - bb, `${pt}px ${pr}px ${pb}px ${pl}px`);
      place(outline, r.left, r.top, r.width, r.height);
      const corners: [number, number][] = [
        [r.left - 2, r.top - 2],
        [r.right - 2, r.top - 2],
        [r.right - 2, r.bottom - 2],
        [r.left - 2, r.bottom - 2],
      ];
      handles.forEach((h, i) => {
        h.style.display = pinned ? "block" : "none";
        const [x, y] = corners[i] ?? [0, 0];
        place(h, x, y, 4, 4);
      });
    },
  };
}
