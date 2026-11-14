import type { AppStatus, SessionInfo } from "@ember-handover/core";
import type { Explanation } from "@ember-handover/core/explain";
import { useEffect, useMemo, useState } from "preact/hooks";
import { api, config, type Result } from "./api.js";
import { createChannel } from "./channel.js";

type Mode = "inspect" | "flows" | "changes";
const MODES: { id: Mode; label: string }[] = [
  { id: "inspect", label: "Inspect" },
  { id: "flows", label: "Flows" },
  { id: "changes", label: "Changes" },
];

export function App() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("inspect");
  const [page, setPage] = useState<{ url: string; title: string } | null>(null);
  const [session, setSession] = useState<Result<SessionInfo> | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);

  const channel = useMemo(
    () =>
      createChannel(config.appOrigins, (e) => {
        if (e.type === "page") setPage({ url: e.url, title: e.title });
        else if (e.key === "toggle") setOpen((o) => !o);
        else setOpen(false);
      }),
    [],
  );

  useEffect(() => {
    void api.session().then(setSession);
  }, []);

  useEffect(() => {
    channel.send({ v: 1, type: "layout", mode: open ? "panel" : "pill" });
  }, [open, channel]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const poll = async () => {
      const r = await api.status();
      if (alive && r.ok) setStatus(r.data);
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") setOpen(false);
      else if (e.key === "d" || e.key === "D") setOpen((o) => !o);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  if (!open) return <Pill onOpen={() => setOpen(true)} />;
  return (
    <Panel
      mode={mode}
      setMode={setMode}
      onClose={() => setOpen(false)}
      page={page}
      session={session}
      status={status}
    />
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

function Kbd({ children }: { children: string }) {
  return (
    <kbd class="rounded-sm border border-ember-indigo bg-ink-800 px-1 font-mono text-[11px] leading-4 text-fg-secondary">
      {children}
    </kbd>
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

function Panel(props: {
  mode: Mode;
  setMode: (m: Mode) => void;
  onClose: () => void;
  page: { url: string; title: string } | null;
  session: Result<SessionInfo> | null;
  status: AppStatus | null;
}) {
  const { mode, setMode, onClose, page, session, status } = props;
  const down = status && (status.state === "restarting" || status.state === "stopped");
  return (
    <section
      data-handoff-panel
      aria-label="Handoff Dev Mode"
      class="flex h-full flex-col border-l border-ink-700 bg-ink-900 text-fg-primary"
    >
      <header class="flex h-11 shrink-0 items-center gap-1 border-b border-ink-700 bg-ink-700 px-2">
        <nav role="tablist" aria-label="Mode" class="flex gap-1">
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
          title="Close (Esc)"
          onClick={onClose}
          class="h-8 rounded-md px-2 text-fg-secondary outline-none hover:bg-ember-indigo/60 focus-visible:ring-2 focus-visible:ring-ember-coral"
        >
          ✕
        </button>
      </header>

      {down && (
        <div role="status" class="border-b border-ember-coral/40 bg-ink-800 px-4 py-3">
          <p class="font-semibold">
            {status.state === "restarting" ? "Your app stopped. Restarting…" : "Your app stopped."}
          </p>
          {status.lines.length > 0 && (
            <pre class="mt-2 overflow-x-auto font-mono text-xs leading-4 whitespace-pre-wrap text-fg-secondary">
              {status.lines.slice(-5).join("\n")}
            </pre>
          )}
        </div>
      )}

      {page && (
        <div class="border-b border-ink-700 px-4 py-2">
          <p class="truncate text-[15px] leading-5 font-semibold" title={page.title}>
            {page.title || "Untitled page"}
          </p>
          <p class="truncate font-mono text-xs leading-4 text-fg-secondary">{pathOf(page.url)}</p>
        </div>
      )}

      <main class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <Empty mode={mode} />
      </main>

      <footer class="flex h-9 shrink-0 items-center gap-2 border-t border-ink-700 px-4 text-xs leading-4 text-fg-secondary">
        <Connection session={session} />
      </footer>
    </section>
  );
}

function Empty({ mode }: { mode: Mode }) {
  const copy: Record<Mode, [string, string]> = {
    inspect: ["Hover any element to see its specs.", "Element inspection arrives in the next preview build."],
    flows: ["Your agent will add flows as it builds.", "Flows arrive in a later preview build."],
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

function Connection({ session }: { session: Result<SessionInfo> | null }) {
  if (!session) return <span>Connecting…</span>;
  if (!session.ok) return <ErrorLine error={session.error} />;
  const port = safePort(session.data.appUrl);
  return (
    <>
      <span aria-hidden="true" class="size-2 rounded-full bg-ember-peach" />
      <span>
        Connected · {session.data.framework ?? "Your"} app{port ? ` on :${port}` : ""}
      </span>
    </>
  );
}

function ErrorLine({ error }: { error: Explanation }) {
  return (
    <span role="alert" title={error.fix}>
      <span aria-hidden="true">⚠ </span>
      {error.message}
    </span>
  );
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
