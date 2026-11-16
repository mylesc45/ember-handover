import type { RawSpec } from "@ember-handover/bridge";
import type { AppStatus, SessionInfo } from "@ember-handover/core";
import type { Explanation } from "@ember-handover/core/explain";
import { EMPTY_TOKENS, normalizeSpec, type TokenSet } from "@ember-handover/tokens";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { api, config, type Result } from "./api.js";
import { createChannel } from "./channel.js";
import { CopyAs } from "./CopyAs.js";
import { Flows } from "./Flows.js";
import { Inspect, type InspectState } from "./Inspect.js";
import { HasTokens, Kbd } from "./ui.js";

type Mode = "inspect" | "flows" | "changes";
const MODES: { id: Mode; label: string }[] = [
  { id: "inspect", label: "Inspect" },
  { id: "flows", label: "Flows" },
  { id: "changes", label: "Changes" },
];

export function App() {
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const [mode, setMode] = useState<Mode>("inspect");
  const [page, setPage] = useState<{ url: string; title: string } | null>(null);
  const [session, setSession] = useState<Result<SessionInfo> | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [tokens, setTokens] = useState<TokenSet>(EMPTY_TOKENS);
  const [live, setLive] = useState<{ spec: RawSpec | null; pinned: boolean }>({ spec: null, pinned: false });
  const [state, setState] = useState<InspectState>("default");
  const [breakpoint, setBreakpoint] = useState<number | null>(null);
  const [remote, setRemote] = useState<{ spec: RawSpec | null; loading: boolean; error: Explanation | null }>({ spec: null, loading: false, error: null });

  const channel = useMemo(
    () =>
      createChannel(config.appOrigins, (e) => {
        if (e.type === "page") setPage({ url: e.url, title: e.title });
        else if (e.type === "spec") setLive({ spec: e.spec, pinned: e.pinned });
        else if (e.key === "toggle") setOpen((o) => !o);
        else if (e.key === "escape") setOpen(false);
        else if (openRef.current) setMode(e.key);
      }),
    [],
  );

  useEffect(() => {
    void api.session().then(setSession);
  }, []);

  useEffect(() => {
    channel.send({ v: 1, type: "layout", mode: open ? "panel" : "pill" });
    channel.send({ v: 1, type: "inspect", on: open && mode === "inspect" });
  }, [open, mode, channel]);

  // Status banner and tokens while the panel is open.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = async () => {
      const r = await api.status();
      if (alive && r.ok) setStatus(r.data);
    };
    void poll();
    void api.tokens().then((r) => alive && r.ok && setTokens(r.data));
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);

  // A new pinned element starts in its default state.
  const pinnedPath = live.pinned ? live.spec?.path : undefined;
  const lastPath = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (pinnedPath !== lastPath.current) {
      lastPath.current = pinnedPath;
      setState("default");
    }
  }, [pinnedPath]);

  // States and breakpoints are re-measured headlessly (SPEC → Layer 1).
  useEffect(() => {
    const needRemote = live.pinned && pinnedPath && page && (state !== "default" || breakpoint !== null);
    if (!needRemote) {
      setRemote({ spec: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setRemote((r) => ({ ...r, loading: true, error: null }));
    void api
      .measure({ url: page.url, path: pinnedPath, ...(state !== "default" ? { state } : {}), ...(breakpoint ? { width: breakpoint } : {}) })
      .then((r) => {
        if (!alive) return;
        setRemote(r.ok ? { spec: r.data, loading: false, error: null } : { spec: null, loading: false, error: r.error });
      });
    return () => {
      alive = false;
    };
  }, [state, breakpoint, pinnedPath, live.pinned, page?.url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.("input, textarea")) return;
      if (e.key === "Escape") {
        if (live.pinned) channel.send({ v: 1, type: "select", to: "none" });
        else setOpen(false);
      } else if (e.key === "d" || e.key === "D") setOpen((o) => !o);
      else if (e.key === "f" || e.key === "F") setMode("flows");
      else if (e.key === "c" || e.key === "C") setMode("changes");
      else if (e.key === "i" || e.key === "I") setMode("inspect");
      else if (live.pinned && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        channel.send({ v: 1, type: "select", to: e.key === "ArrowUp" ? "parent" : "child" });
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [live.pinned, channel]);

  const shown = remote.spec ?? (remote.error || remote.loading ? live.spec : live.spec);
  const spec = useMemo(() => (shown ? normalizeSpec(shown, tokens) : null), [shown, tokens]);
  const breakpoints = useMemo(() => pickBreakpoints(tokens.breakpoints.map((b) => b.px)), [tokens]);
  const route = page ? pathOf(page.url) : "/";

  if (!open) return <Pill onOpen={() => setOpen(true)} />;
  const down = status && (status.state === "restarting" || status.state === "stopped");
  const remoteLabel =
    remote.spec && (state !== "default" || breakpoint)
      ? `Measured in a headless browser${breakpoint ? ` at ${breakpoint} px` : ""}${state !== "default" ? `, ${state} state` : ""}.`
      : null;

  return (
    <section data-handoff-panel aria-label="Handoff Dev Mode" class="flex h-full flex-col border-l border-ink-700 bg-ink-900 text-fg-primary">
      <header class="flex h-11 shrink-0 items-center gap-1 border-b border-ink-700 bg-ink-700 px-2">
        <nav role="tablist" aria-label="Mode" class="flex shrink-0 gap-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              class={`h-8 rounded-md px-2 font-medium outline-none focus-visible:ring-2 focus-visible:ring-ember-coral ${
                mode === m.id ? "bg-ember-indigo text-fg-primary" : "text-fg-secondary hover:bg-ember-indigo/60"
              }`}
            >
              {m.label}
            </button>
          ))}
        </nav>
        <div class="flex-1" />
        <button
          type="button"
          aria-label="Close Dev Mode"
          data-handoff-close
          title="Close (Esc)"
          onClick={() => setOpen(false)}
          class="h-8 shrink-0 rounded-md px-2 text-fg-secondary outline-none hover:bg-ember-indigo/60 focus-visible:ring-2 focus-visible:ring-ember-coral"
        >
          ✕
        </button>
      </header>

      {down && (
        <div role="status" class="border-b border-ember-coral/40 bg-ink-800 px-4 py-3">
          <p class="font-semibold">{status.state === "restarting" ? "Your app stopped. Restarting…" : "Your app stopped."}</p>
          {status.lines.length > 0 && (
            <pre class="mt-2 overflow-x-auto font-mono text-xs leading-4 whitespace-pre-wrap text-fg-secondary">{status.lines.slice(-5).join("\n")}</pre>
          )}
        </div>
      )}

      {page && mode === "changes" && (
        <div class="border-b border-ink-700 px-4 py-2">
          <p class="truncate text-[15px] leading-5 font-semibold" title={page.title}>
            {page.title || "Untitled page"}
          </p>
          <p class="truncate font-mono text-xs leading-4 text-fg-secondary">{route}</p>
        </div>
      )}

      {mode === "inspect" ? (
        <HasTokens.Provider value={tokens.tokens.length > 0}>
        <Inspect
          spec={spec}
          pinned={live.pinned}
          state={state}
          setState={setState}
          remote={{ loading: remote.loading, error: remote.error, label: remoteLabel }}
          breakpoints={breakpoints}
          breakpoint={breakpoint}
          setBreakpoint={setBreakpoint}
          onAncestor={(index) => channel.send({ v: 1, type: "select", to: "ancestor", index })}
        />
        </HasTokens.Provider>
      ) : mode === "flows" ? (
        <Flows route={route} navigate={(path) => channel.send({ v: 1, type: "navigate", path })} />
      ) : (
        <main class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <Empty mode={mode} />
        </main>
      )}

      {mode !== "flows" && (
      <footer class="flex min-h-12 shrink-0 items-center gap-2 border-t border-ink-700 px-4 py-2 text-xs leading-4 text-fg-secondary">
        <Connection session={session} page={page} />
        <span class="flex-1" />
        {mode === "inspect" && <CopyAs spec={spec} route={route} />}
      </footer>
      )}
    </section>
  );
}

function Logo() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="1" y="1" width="12" height="12" rx="3" fill="none" stroke="#F64668" stroke-width="2" />
      <rect x="5" y="5" width="4" height="4" rx="1" fill="#FE9677" />
    </svg>
  );
}

function Pill({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      data-handoff-pill
      onClick={onOpen}
      class="flex h-8 w-full items-center justify-center gap-2 rounded-full border border-ember-indigo bg-ink-900 px-3 font-medium text-fg-primary outline-none hover:bg-ink-800 focus-visible:ring-2 focus-visible:ring-ember-coral"
    >
      <Logo />
      <span>Dev Mode</span>
      <Kbd>D</Kbd>
    </button>
  );
}

function Empty({ mode }: { mode: "changes" }) {
  const copy: Record<"changes", [string, string]> = {
    changes: ["No changes to review yet.", "Run `npx ember-handover review <pr>` once review ships."],
  };
  const [title, body] = copy[mode];
  return (
    <>
      <p class="text-[15px] leading-5 font-semibold">{title}</p>
      <p class="text-fg-secondary">{body}</p>
    </>
  );
}

function Connection({ session, page }: { session: Result<SessionInfo> | null; page: { url: string; title: string } | null }) {
  if (!session) return <span>Connecting…</span>;
  if (!session.ok)
    return (
      <span role="alert" title={session.error.fix}>
        ⚠ {session.error.message}
      </span>
    );
  const port = safePort(session.data.appUrl);
  return (
    <span class="flex min-w-0 items-center gap-2" title={page?.title}>
      <span aria-hidden="true" class="size-2 shrink-0 rounded-full bg-ember-peach" />
      <span class="truncate">
        Connected · {session.data.framework ?? "Your"} app{port ? ` on :${port}` : ""}
        {page?.title ? ` · ${page.title}` : ""}
      </span>
    </span>
  );
}

/** Three widths, as in SPEC (375 · 768 · 1280): a phone, then the detected breakpoints nearest tablet and desktop. */
function pickBreakpoints(detected: number[]): number[] {
  const pool = [...new Set([375, ...detected])];
  const nearest = (target: number) => pool.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  return [...new Set([375, nearest(768), nearest(1280)])].sort((a, b) => a - b);
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function safePort(url: string): string | null {
  try {
    return new URL(url).port || null;
  } catch {
    return null;
  }
}
