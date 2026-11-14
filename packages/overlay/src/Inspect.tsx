import type { Quad } from "@ember-handover/bridge";
import type { Explanation } from "@ember-handover/core/explain";
import type { ColorValue, Spec } from "@ember-handover/tokens";
import { fmt, fmtPx, Kbd, Row, Section, Swatch, TokenChip, useCopied } from "./ui.js";

export type InspectState = "default" | "hover" | "focus" | "active" | "disabled";
const STATES: { id: InspectState; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "hover", label: "Hover" },
  { id: "focus", label: "Focus" },
  { id: "active", label: "Active" },
  { id: "disabled", label: "Disabled" },
];

export interface InspectProps {
  spec: Spec | null;
  pinned: boolean;
  state: InspectState;
  setState: (s: InspectState) => void;
  /** Set when values come from a headless re-measure (state or breakpoint). */
  remote: { loading: boolean; error: Explanation | null; label: string | null };
  onAncestor: (index: number) => void;
  breakpoints: number[];
  breakpoint: number | null;
  setBreakpoint: (px: number | null) => void;
}

const sides = (q: Quad) => (q.every((v) => v === q[0]) ? fmtPx(q[0]) : q.map(fmtPx).join(" "));

export function Inspect(p: InspectProps) {
  const s = p.spec;
  if (!s) {
    return (
      <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <p class="text-[15px] leading-5 font-semibold">Hover any element to see its specs.</p>
        <p class="text-fg-secondary">
          Click to pin it. <Kbd>↑</Kbd> <Kbd>↓</Kbd> move to the parent or child.
        </p>
      </div>
    );
  }
  return (
    <div class="flex-1 overflow-y-auto" data-handoff-inspect>
      <Header spec={s} pinned={p.pinned} onAncestor={p.onAncestor} />
      <States {...p} />
      <Layout spec={s} />
      <Typography spec={s} />
      <Colours spec={s} />
      <Effects spec={s} />
      <Accessibility spec={s} />
    </div>
  );
}

function Header({ spec, pinned, onAncestor }: { spec: Spec; pinned: boolean; onAncestor: (i: number) => void }) {
  const el = spec.element;
  const crumbs = el.ancestors.filter((a) => a.tag !== "html").slice(0, 6).reverse();
  return (
    <div class="border-b border-ink-700 px-4 py-3">
      <div class="flex items-center gap-2">
        <p class="font-mono text-[15px] leading-5 font-semibold">&lt;{el.tag}&gt;</p>
        {el.testid && <span class="rounded-sm bg-ink-800 px-1.5 font-mono text-[11px] leading-5 text-fg-secondary">{el.testid}</span>}
        <span class="flex-1" />
        <span class="text-[11px] leading-4 text-fg-secondary">{pinned ? "Pinned · Esc to unpin" : "Hovering"}</span>
      </div>
      {crumbs.length > 0 && (
        <nav aria-label="Parents" class="mt-1 flex flex-wrap items-center gap-x-1 font-mono text-[11px] leading-4 text-fg-secondary">
          {crumbs.map((a, i) => {
            const index = crumbs.length - 1 - i;
            return (
              <span key={index} class="flex items-center gap-1">
                <button type="button" class="rounded-sm px-0.5 hover:bg-ember-indigo/60 hover:text-fg-primary" onClick={() => onAncestor(index)} title="Select this parent">
                  {a.tag}
                  {a.id ? `#${a.id}` : ""}
                </button>
                <span aria-hidden="true">›</span>
              </span>
            );
          })}
          <span class="text-fg-primary">{el.tag}</span>
        </nav>
      )}
    </div>
  );
}

function States(p: InspectProps) {
  const live = p.spec?.live;
  const showingLive = p.state === "default" && !p.remote.label && live && (live.hover || live.focus || live.active);
  return (
    <div class="border-b border-ink-700 px-4 py-2">
      <div role="radiogroup" aria-label="State" class="flex gap-0.5 rounded-md bg-ink-800 p-0.5">
        {STATES.map((st) => (
          <button
            key={st.id}
            type="button"
            role="radio"
            aria-checked={p.state === st.id}
            disabled={!p.pinned && st.id !== "default"}
            title={!p.pinned && st.id !== "default" ? "Pin an element to see its states" : undefined}
            onClick={() => p.setState(st.id)}
            class={`h-7 flex-1 rounded-sm text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ember-coral disabled:text-fg-disabled ${
              p.state === st.id ? "bg-ember-indigo text-fg-primary" : "text-fg-secondary hover:text-fg-primary"
            }`}
          >
            {st.label}
          </button>
        ))}
      </div>
      {p.breakpoints.length > 0 && (
        <div role="radiogroup" aria-label="Width" class="mt-1.5 flex items-center gap-0.5">
          <span class="mr-1 w-12 text-[11px] leading-4 text-fg-secondary">Width</span>
          {[null, ...p.breakpoints].map((bp) => (
            <button
              key={bp ?? "live"}
              type="button"
              role="radio"
              aria-checked={p.breakpoint === bp}
              disabled={bp !== null && !p.pinned}
              title={bp === null ? "Current window size" : p.pinned ? `Measure at ${bp} px wide` : "Pin an element first"}
              onClick={() => p.setBreakpoint(bp)}
              class={`h-6 flex-1 rounded-sm font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ember-coral disabled:text-fg-disabled ${
                p.breakpoint === bp ? "bg-ember-indigo text-fg-primary" : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {bp ?? "Live"}
            </button>
          ))}
        </div>
      )}
      {showingLive && (
        <p class="mt-1.5 text-[11px] leading-4 text-ember-peach" role="status">
          {live.hover ? "Your pointer is over this element, so hover styles are showing. Move away for the default." : "This element has focus, so focus styles are showing."}
        </p>
      )}
      {(p.remote.loading || p.remote.error || p.remote.label) && (
        <p class={`mt-1.5 text-[11px] leading-4 ${p.remote.error ? "text-ember-peach" : "text-fg-secondary"}`} role={p.remote.error ? "alert" : "status"}>
          {p.remote.loading ? "Measuring in a headless browser…" : p.remote.error ? `${p.remote.error.message} ${p.remote.error.fix}` : p.remote.label}
        </p>
      )}
    </div>
  );
}

function BoxModel({ spec }: { spec: Spec }) {
  const b = spec.box;
  const contentW = b.width - b.padding[1] - b.padding[3] - b.border[1] - b.border[3];
  const contentH = b.height - b.padding[0] - b.padding[2] - b.border[0] - b.border[2];
  const Band = ({ q, label, tone, children }: { q: Quad; label: string; tone: string; children: preact.ComponentChildren }) => {
    const [copied, copy] = useCopied();
    return (
      <div class={`relative rounded-sm border border-dashed px-6 py-4 ${tone}`}>
        <button type="button" class="absolute top-0.5 left-1 text-[10px] leading-3 text-fg-secondary" onClick={() => copy(sides(q))} title={`Copy ${label}`}>
          {copied ? "Copied" : label}
        </button>
        <span class="absolute top-0.5 left-1/2 -translate-x-1/2 font-mono text-[10px] leading-3">{fmt(q[0])}</span>
        <span class="absolute top-1/2 right-1 -translate-y-1/2 font-mono text-[10px] leading-3">{fmt(q[1])}</span>
        <span class="absolute bottom-0.5 left-1/2 -translate-x-1/2 font-mono text-[10px] leading-3">{fmt(q[2])}</span>
        <span class="absolute top-1/2 left-1 -translate-y-1/2 font-mono text-[10px] leading-3">{fmt(q[3])}</span>
        {children}
      </div>
    );
  };
  return (
    <div class="mt-2 text-center" aria-label="Box model">
      <Band q={b.margin} label="margin" tone="border-ember-peach/50 bg-ember-peach/10">
        <Band q={b.border} label="border" tone="border-fg-secondary/50 bg-ink-800">
          <Band q={b.padding} label="padding" tone="border-ember-coral/50 bg-ember-coral/10">
            <div class="rounded-sm bg-ember-indigo px-2 py-1 font-mono text-[11px] leading-4">
              {fmt(contentW)} × {fmt(contentH)}
            </div>
          </Band>
        </Band>
      </Band>
    </div>
  );
}

function Layout({ spec }: { spec: Spec }) {
  const b = spec.box;
  const L = spec.layout;
  const flex = /flex/.test(L.display);
  const grid = /grid/.test(L.display);
  return (
    <Section title="Layout">
      <Row label="Size" value={`${fmt(b.width)} × ${fmt(b.height)}`} copy={`width: ${fmtPx(b.width)};\nheight: ${fmtPx(b.height)};`} />
      <Row label="Padding" value={sides(b.padding)}>
        {b.padding.some((v) => v !== 0) && <TokenChip match={b.tokens.padding} prop="padding" />}
      </Row>
      {b.margin.some((v) => v !== 0) && <Row label="Margin" value={sides(b.margin)} />}
      {b.border.some((v) => v !== 0) && <Row label="Border" value={`${sides(b.border)} ${b.borderStyle}`} />}
      <Row label="Display" value={L.display} />
      {flex && <Row label="Direction" value={L.flexDirection} />}
      {grid && L.gridTemplateColumns !== "none" && <Row label="Columns" value={L.gridTemplateColumns} />}
      {(flex || grid) && L.alignItems !== "normal" && <Row label="Align" value={L.alignItems} />}
      {(flex || grid) && L.justifyContent !== "normal" && <Row label="Justify" value={L.justifyContent} />}
      {b.gap && (b.gap.row > 0 || b.gap.column > 0) && (
        <Row label="Gap" value={b.gap.row === b.gap.column ? fmtPx(b.gap.row) : `${fmtPx(b.gap.row)} ${fmtPx(b.gap.column)}`}>
          <TokenChip match={b.tokens.gap} prop="gap" />
        </Row>
      )}
      {L.position !== "static" && <Row label="Position" value={L.position} />}
      <BoxModel spec={spec} />
    </Section>
  );
}

function Typography({ spec }: { spec: Spec }) {
  const t = spec.typography;
  return (
    <Section title="Typography">
      <Row label="Font" value={t.rendered ?? t.family} copy={t.stack} title={`Stack: ${t.stack}`}>
        <TokenChip match={t.tokens.family} prop="fontFamily" />
      </Row>
      <Row label="Size" value={fmtPx(t.size)}>
        <TokenChip match={t.tokens.size} prop="fontSize" />
      </Row>
      <Row label="Weight" value={String(t.weight)}>
        <TokenChip match={t.tokens.weight} prop="fontWeight" />
      </Row>
      <Row label="Line height" value={t.lineHeight === null ? "normal" : fmtPx(t.lineHeight)}>
        {t.lineHeight !== null && <TokenChip match={t.tokens.lineHeight} prop="lineHeight" />}
      </Row>
      <Row label="Letter spacing" value={t.letterSpacing === null ? "normal" : fmtPx(t.letterSpacing)} />
      {t.textTransform !== "none" && <Row label="Transform" value={t.textTransform} />}
      {t.fontStyle !== "normal" && <Row label="Style" value={t.fontStyle} />}
    </Section>
  );
}

function ColourRow({ label, value, prop }: { label: string; value: ColorValue | null; prop: string }) {
  if (!value) return <Row label={label} value="none" />;
  return (
    <Row label={label} value={value.hex} title={`${value.oklch} · computed ${value.raw}`}>
      <TokenChip match={value.token} prop={prop} unit="ΔE" />
      <Swatch hex={value.hex} />
    </Row>
  );
}

function Colours({ spec }: { spec: Spec }) {
  return (
    <Section title="Colour">
      <ColourRow label="Text" value={spec.colors.text} prop="color" />
      <ColourRow label="Background" value={spec.colors.background} prop="backgroundColor" />
      {spec.box.border.some((v) => v > 0) && <ColourRow label="Border" value={spec.colors.border} prop="borderColor" />}
    </Section>
  );
}

function Effects({ spec }: { spec: Spec }) {
  const e = spec.effects;
  const r = e.radius;
  return (
    <Section title="Effects">
      <Row label="Radius" value={r.every((v) => v === r[0]) ? fmtPx(r[0]) : r.map(fmtPx).join(" ")}>
        {r[0] > 0 && <TokenChip match={e.tokens.radius} prop="borderRadius" />}
      </Row>
      {e.shadow !== "none" && (
        <Row label="Shadow" value={e.shadow}>
          <TokenChip match={e.tokens.shadow} prop="boxShadow" />
        </Row>
      )}
      <Row label="Opacity" value={fmt(e.opacity)} />
      {e.transform !== "none" && <Row label="Transform" value={e.transform} />}
      {e.transition.split(", ").some((t) => !/ 0s \S+(?:\([^)]*\))? 0s$/.test(t)) && <Row label="Transition" value={e.transition} />}
    </Section>
  );
}

function Accessibility({ spec }: { spec: Spec }) {
  const a = spec.a11y;
  return (
    <Section title="Accessibility">
      <Row label="Role" value={a.role} />
      <Row label="Name" value={a.name || "none"} />
      {a.contrast && (
        <Row label="Contrast" value={`${a.contrast.ratio}:1`} title={`Against ${a.contrast.background}${a.contrast.large ? " (large text: 3:1 needed)" : " (4.5:1 needed)"}`}>
          <span class="shrink-0 text-[11px] leading-4 whitespace-nowrap text-fg-primary">
            <span aria-hidden="true" class={a.contrast.aa ? "text-ember-peach" : "text-ember-coral"}>
              {a.contrast.aa ? "✓ " : "✕ "}
            </span>
            {a.contrast.aa ? "AA pass" : "AA fail"}
          </span>
        </Row>
      )}
    </Section>
  );
}
