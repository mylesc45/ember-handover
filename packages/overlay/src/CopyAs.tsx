import { type Spec, toCss, toPrompt, toTailwind, toTokenCss } from "@ember-handover/tokens";
import { useEffect, useRef, useState } from "preact/hooks";
import { useCopied } from "./ui.js";

type Format = "css" | "tailwind" | "tokens" | "prompt";
const FORMATS: { id: Format; label: string }[] = [
  { id: "css", label: "CSS" },
  { id: "tailwind", label: "Tailwind" },
  { id: "tokens", label: "Tokens" },
  { id: "prompt", label: "Prompt for agent" },
];

const remembered = (): Format => {
  try {
    const f = localStorage.getItem("handoff.copyFormat");
    return FORMATS.some((x) => x.id === f) ? (f as Format) : "css";
  } catch {
    return "css";
  }
};

export function render(spec: Spec, f: Format, route: string): string {
  if (f === "css") return toCss(spec);
  if (f === "tailwind") return toTailwind(spec);
  if (f === "tokens") return toTokenCss(spec);
  return toPrompt(spec, { route });
}

/** The panel's one primary action (coral, bottom-right): copy the spec in the chosen format. */
export function CopyAs({ spec, route }: { spec: Spec | null; route: string }) {
  const [format, setFormat] = useState<Format>(remembered);
  const [open, setOpen] = useState(false);
  const [copied, copy] = useCopied();
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !menu.current?.contains(e.target as Node) && setOpen(false);
    addEventListener("mousedown", close);
    return () => removeEventListener("mousedown", close);
  }, [open]);

  const choose = (f: Format) => {
    setFormat(f);
    setOpen(false);
    try {
      localStorage.setItem("handoff.copyFormat", f);
    } catch {
      /* private mode: just don't remember */
    }
    if (spec) copy(render(spec, f, route));
  };
  const label = FORMATS.find((f) => f.id === format)?.label ?? "CSS";
  const ring = "outline-none focus-visible:ring-2 focus-visible:ring-ember-coral focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900";
  return (
    <div class="relative flex shrink-0" ref={menu}>
      <button
        type="button"
        data-handoff-copy
        disabled={!spec}
        onClick={() => spec && copy(render(spec, format, route))}
        class={`h-8 rounded-l-md bg-ember-coral px-3 font-semibold whitespace-nowrap text-ink-950 hover:brightness-110 disabled:opacity-50 ${ring}`}
      >
        {copied ? "Copied" : `Copy ${label}`}
      </button>
      <button
        type="button"
        aria-label="Choose copy format"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={!spec}
        onClick={() => setOpen((o) => !o)}
        class={`h-8 rounded-r-md border-l border-ink-950/30 bg-ember-coral px-2 font-semibold text-ink-950 hover:brightness-110 disabled:opacity-50 ${ring}`}
      >
        ▾
      </button>
      {open && (
        <div role="menu" class="absolute right-0 bottom-10 w-48 rounded-md border border-ink-700 bg-ink-800 p-1 shadow-panel">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="menuitem"
              onClick={() => choose(f.id)}
              class="flex h-8 w-full items-center rounded-sm px-2 text-left hover:bg-ember-indigo/60 focus-visible:bg-ember-indigo/60 focus-visible:outline-none"
            >
              {f.label}
              {f.id === format && <span class="ml-auto text-fg-secondary">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
