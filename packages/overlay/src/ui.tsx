import type { ComponentChildren } from "preact";
import { createContext } from "preact";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import { tokenLabel, type TokenMatch } from "@ember-handover/tokens";

export const fmt = (n: number) => String(+n.toFixed(2));
export const fmtPx = (n: number) => (n === 0 ? "0" : `${fmt(n)}px`);

/** Copy text from the overlay iframe. Falls back to execCommand where the Clipboard API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

/** "Copied" confirmation that lasts 1.5 s (SPEC → Interaction rules). */
export function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [
    copied,
    (text: string) => {
      void copyText(text).then((ok) => {
        if (!ok) return;
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), 1500);
      });
    },
  ];
}

export function Section({ title, children, aside }: { title: string; children: ComponentChildren; aside?: ComponentChildren }) {
  return (
    <section class="border-b border-ink-700 px-4 py-3">
      <div class="mb-2 flex items-center justify-between">
        <h3 class="text-xs leading-4 font-medium text-fg-secondary">{title}</h3>
        {aside}
      </div>
      <div class="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}

/** Label left, value right (mono); the whole row copies the value. */
export function Row(props: { label: string; value: string; copy?: string; children?: ComponentChildren; title?: string }) {
  const [copied, copy] = useCopied();
  return (
    <button
      type="button"
      title={props.title ?? `Copy ${props.copy ?? props.value}`}
      onClick={() => copy(props.copy ?? props.value)}
      class="group flex min-h-7 w-full items-center gap-2 rounded-sm px-1.5 text-left outline-none hover:bg-ember-indigo/60 focus-visible:ring-2 focus-visible:ring-ember-coral"
    >
      <span class="w-[5.5rem] shrink-0 text-xs leading-4 font-medium text-fg-secondary">{props.label}</span>
      <span class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
        {props.children}
        <span class={`max-w-[11rem] shrink-0 truncate font-mono text-xs leading-4 ${copied ? "text-ember-peach" : ""}`} aria-live="polite">
          {copied ? "Copied" : props.value}
        </span>
      </span>
    </button>
  );
}

/** Whether the repo has any design tokens; without them "no token" on every row is just noise. */
export const HasTokens = createContext(false);

/** Token chip. Exact: token name. Near: peach underline + "off by N". None: muted "no token". */
export function TokenChip({ match, prop, unit = "px" }: { match: TokenMatch; prop: string; unit?: string }) {
  const hasTokens = useContext(HasTokens);
  if (match.status === "none") return hasTokens ? <span class="shrink-0 text-[11px] leading-4 whitespace-nowrap text-fg-disabled">no token</span> : null;
  const label = tokenLabel(prop, match.token);
  if (match.status === "match")
    return (
      <span class="min-w-0 truncate rounded-sm bg-ink-800 px-1.5 font-mono text-[11px] leading-5 whitespace-nowrap text-fg-primary" title={`${match.token.cssVar ?? match.token.name} · ${match.token.source.file}`}>
        {label}
      </span>
    );
  return (
    <span
      class="min-w-0 truncate rounded-sm bg-ink-800 px-1.5 font-mono text-[11px] leading-5 whitespace-nowrap text-ember-peach underline decoration-ember-peach underline-offset-2"
      title={`Nearest token ${label}: ${match.token.hex ?? `${match.token.px}px`}`}
    >
      {unit === "ΔE" ? `${label} ΔE ${match.delta}` : `${label} · off by ${match.delta} px`}
    </span>
  );
}

export function Swatch({ hex }: { hex: string }) {
  return <span aria-hidden="true" class="size-3.5 shrink-0 rounded-sm border border-ink-700" style={{ background: hex }} />;
}

export function Kbd({ children }: { children: string }) {
  return <kbd class="rounded-sm border border-ember-indigo bg-ink-800 px-1 font-mono text-[11px] leading-4 text-fg-secondary">{children}</kbd>;
}
