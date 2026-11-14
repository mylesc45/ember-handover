import { describeStep, type Flow } from "@ember-handover/core/flow-model";
import { explain, type Explanation } from "@ember-handover/core/explain";
import { useEffect, useState } from "preact/hooks";
import { api, type FlowListing, type FlowStatus, type ReplayResult } from "./api.js";

const STATUS: Record<FlowStatus, { label: string; icon: string; tone: string }> = {
  passing: { label: "Passing", icon: "✓", tone: "text-ember-peach" },
  failing: { label: "Failing", icon: "✕", tone: "text-ember-coral" },
  stale: { label: "Stale", icon: "↻", tone: "text-fg-secondary" },
  "not-run": { label: "Not run", icon: "○", tone: "text-fg-disabled" },
};

function StatusBadge({ status }: { status: FlowStatus }) {
  const s = STATUS[status];
  return (
    <span class="flex shrink-0 items-center gap-1 text-[11px] leading-4 whitespace-nowrap text-fg-primary">
      <span aria-hidden="true" class={s.tone}>
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

/** Screenshot fetched with the session token; revoked when it goes away. */
function Shot({ flow, state, step, class: cls, alt }: { flow: string; state: string | null; step: number; class: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    void api.shot(flow, state, step).then((u) => {
      url = u;
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [flow, state, step]);
  if (!src) return <div class={`${cls} bg-ink-800`} aria-hidden="true" />;
  return <img data-handoff-shot src={src} alt={alt} class={`${cls} object-cover object-top`} />;
}

export interface FlowsProps {
  /** Opens a page of the app in the user's tab (Live mode). */
  navigate: (path: string) => void;
  route: string;
}

export function Flows({ navigate }: FlowsProps) {
  const [listing, setListing] = useState<FlowListing | null>(null);
  const [error, setError] = useState<Explanation | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () =>
    void api.flows().then((r) => {
      if (r.ok) {
        setListing(r.data);
        setError(null);
      } else setError(r.error);
    });
  useEffect(load, []);

  if (error) return <Message title={error.message} body={error.fix} />;
  if (!listing) return <Message title="Loading flows…" body="" />;
  if (!listing.exists)
    return (
      <Message
        title="Your agent will add flows as it builds."
        body="Run `npx ember-handover` in a terminal and answer Y to connect your coding agent; it drafts flows from your routes."
      />
    );
  const entry = listing.flows.find((f) => f.flow.id === open);
  if (entry) return <Player entry={entry} onBack={() => (setOpen(null), load())} onReplayed={load} navigate={navigate} />;

  return (
    <div class="flex-1 overflow-y-auto">
      {listing.errors.length > 0 && (
        <div role="alert" class="border-b border-ember-coral/40 bg-ink-800 px-4 py-3">
          <p class="font-semibold">flows.yaml has a problem, so flows can't run.</p>
          {listing.errors.map((e, i) => (
            <p key={i} class="mt-1 text-fg-secondary">
              {explain("FLOWS_INVALID", { line: e.line ?? "?", message: e.message }).message}
            </p>
          ))}
        </div>
      )}
      {listing.flows.length === 0 && listing.errors.length === 0 && (
        <Message title="No flows yet." body="Your agent adds flows to .handoff/flows.yaml as it builds UI." />
      )}
      <ul class="flex flex-col">
        {listing.flows.map(({ flow, status, result }) => (
          <li key={flow.id} class="border-b border-ink-700">
            <button
              type="button"
              data-handoff-flow
              onClick={() => setOpen(flow.id)}
              class="flex w-full flex-col gap-1.5 px-4 py-3 text-left outline-none hover:bg-ember-indigo/30 focus-visible:bg-ember-indigo/40"
            >
              <span class="flex w-full items-center gap-2">
                <span class="min-w-0 flex-1 truncate text-[15px] leading-5 font-semibold">{flow.name}</span>
                <StatusBadge status={status} />
              </span>
              {flow.intent && <span class="line-clamp-2 text-fg-secondary">{flow.intent}</span>}
              <span class="text-[11px] leading-4 text-fg-secondary">
                {flow.steps.length} {flow.steps.length === 1 ? "step" : "steps"}
                {flow.states.length ? ` · ${flow.states.length} ${flow.states.length === 1 ? "state" : "states"}` : ""}
              </span>
              {result && result.steps.length > 0 && (
                <span class="flex gap-1" aria-hidden="true">
                  {result.steps.slice(0, 4).map((s) => (
                    <Shot key={s.index} flow={flow.id} state={null} step={s.index + 1} alt="" class="h-12 w-[4.75rem] rounded-sm border border-ink-700" />
                  ))}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <p class="text-[15px] leading-5 font-semibold">{title}</p>
      {body && <p class="text-fg-secondary">{body}</p>}
    </div>
  );
}

function Player(props: {
  entry: FlowListing["flows"][number];
  onBack: () => void;
  onReplayed: () => void;
  navigate: (path: string) => void;
}) {
  const { flow } = props.entry;
  const [step, setStep] = useState(0);
  const [state, setState] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<Explanation | null>(null);
  const [results, setResults] = useState<Record<string, ReplayResult | null>>({ default: props.entry.result, ...props.entry.states });
  const result = results[state ?? "default"] ?? null;
  const ran = result?.steps[step];
  const s = flow.steps[step] ?? flow.steps[0];

  const pathAt = (i: number): string | null => {
    const r = result?.steps[i];
    if (r) {
      try {
        const u = new URL(r.url);
        return u.pathname + u.search + u.hash;
      } catch {
        /* fall through to the flow definition */
      }
    }
    for (let k = i; k >= 0; k--) {
      const st = flow.steps[k];
      if (st && "goto" in st) return st.goto;
    }
    return null;
  };

  useEffect(() => {
    if (!live) return;
    const p = pathAt(step);
    if (p) props.navigate(p);
  }, [live, step, state]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((i) => Math.min(flow.steps.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setStep((i) => Math.max(0, i - 1));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [flow.steps.length]);

  const replay = async () => {
    setReplaying(true);
    setError(null);
    const r = await api.replay(flow.id, state);
    setReplaying(false);
    if (!r.ok) return setError(r.error);
    setResults((prev) => ({ ...prev, [state ?? "default"]: r.data }));
    if (r.data.failedAt !== undefined) setStep(r.data.failedAt);
    props.onReplayed();
  };

  const stateName = (id: string) => flow.states.find((x) => x.id === id)?.name ?? id;
  return (
    <div class="flex flex-1 flex-col overflow-hidden" data-handoff-player>
      <div class="border-b border-ink-700 px-4 py-3">
        <button type="button" onClick={props.onBack} class="mb-1 rounded-sm text-xs text-fg-secondary outline-none hover:text-fg-primary focus-visible:ring-2 focus-visible:ring-ember-coral">
          ← Flows
        </button>
        <p class="text-[15px] leading-5 font-semibold">{flow.name}</p>
        {flow.intent && <p class="text-fg-secondary">{flow.intent}</p>}
      </div>

      <div class="border-b border-ink-700 px-4 py-2">
        <div class="flex items-center gap-2">
          <button type="button" aria-label="Previous step" disabled={step === 0} onClick={() => setStep(step - 1)} class="h-7 rounded-sm px-2 text-fg-secondary hover:text-fg-primary disabled:text-fg-disabled">
            ←
          </button>
          <p class="flex-1 text-center text-xs font-medium" aria-live="polite">
            Step {step + 1} of {flow.steps.length}
          </p>
          <button
            type="button"
            aria-label="Next step"
            disabled={step === flow.steps.length - 1}
            onClick={() => setStep(step + 1)}
            class="h-7 rounded-sm px-2 text-fg-secondary hover:text-fg-primary disabled:text-fg-disabled"
          >
            →
          </button>
        </div>
        <ol class="mt-1 flex gap-0.5" aria-label="Steps">
          {flow.steps.map((_, i) => {
            const r = result?.steps[i];
            const tone = !r ? "bg-ink-700" : r.ok ? "bg-ember-peach" : "bg-ember-coral";
            return (
              <li key={i} class="flex-1">
                <button type="button" aria-label={`Step ${i + 1}`} aria-current={i === step} onClick={() => setStep(i)} class={`h-1.5 w-full rounded-full ${tone} ${i === step ? "outline-2 outline-offset-1 outline-fg-primary" : ""}`} />
              </li>
            );
          })}
        </ol>
        {flow.states.length > 0 && (
          <div role="radiogroup" aria-label="State" class="mt-2 flex gap-0.5 rounded-md bg-ink-800 p-0.5">
            {[null, ...flow.states.map((x) => x.id)].map((id) => (
              <button
                key={id ?? "default"}
                type="button"
                role="radio"
                aria-checked={state === id}
                onClick={() => setState(id)}
                class={`h-7 flex-1 truncate rounded-sm px-1 text-xs font-medium ${state === id ? "bg-ember-indigo text-fg-primary" : "text-fg-secondary hover:text-fg-primary"}`}
              >
                {id ? stateName(id) : "Default"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-3">
        {s && <p class="font-mono text-xs leading-4">{describeStep(s)}</p>}
        {s?.intent && <p class="mt-1 text-fg-secondary">{s.intent}</p>}
        {ran && !ran.ok && (
          <div role="alert" class="mt-2 rounded-md border border-ember-coral/50 bg-ink-800 p-2">
            <p class="font-semibold">
              <span aria-hidden="true" class="text-ember-coral">
                ✕{" "}
              </span>
              {ran.error}
            </p>
            {ran.actual && <p class="mt-1 text-xs text-fg-secondary">The page showed: {ran.actual}</p>}
          </div>
        )}

        <div role="radiogroup" aria-label="View" class="mt-3 flex gap-0.5 rounded-md bg-ink-800 p-0.5">
          {(["Screenshot", "Live"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={live === (m === "Live")}
              onClick={() => setLive(m === "Live")}
              class={`h-7 flex-1 rounded-sm text-xs font-medium ${live === (m === "Live") ? "bg-ember-indigo text-fg-primary" : "text-fg-secondary hover:text-fg-primary"}`}
            >
              {m}
            </button>
          ))}
        </div>
        {live ? (
          <p class="mt-2 text-xs text-fg-secondary">
            Your tab shows this step's page ({pathAt(step) ?? "/"}). Clicks and typing are replayed headlessly; switch to Screenshot to see the exact frame.
          </p>
        ) : ran?.screenshot ? (
          <Shot flow={flow.id} state={state} step={step + 1} alt={`Screenshot after step ${step + 1}${s ? `: ${describeStep(s)}` : ""}`} class="mt-2 w-full rounded-md border border-ink-700" />
        ) : (
          <p class="mt-2 text-xs text-fg-secondary">{result ? "This step didn't run because an earlier step failed." : "Not replayed yet. Replay the flow to capture each step."}</p>
        )}
        {error && (
          <p role="alert" class="mt-2 text-xs text-ember-peach">
            {error.message} {error.fix}
          </p>
        )}
      </div>

      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-ink-700 px-4 py-2">
        {result && <span class="mr-auto text-[11px] text-fg-secondary">Last run {new Date(result.at).toLocaleTimeString()}</span>}
        <button
          type="button"
          data-handoff-replay
          disabled={replaying}
          onClick={() => void replay()}
          class="h-8 rounded-md bg-ember-coral px-3 font-semibold whitespace-nowrap text-ink-950 outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ember-coral focus-visible:ring-offset-2 focus-visible:ring-offset-ink-900 disabled:opacity-60"
        >
          {replaying ? "Replaying…" : "Replay flow"}
        </button>
      </div>
    </div>
  );
}

export type { Flow };
