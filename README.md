# Handoff (`ember-handover`)

> Working name. Early development (M2 + M4): Inspect (exact specs, tokens, drift, states, widths, copy formats) and Flows (agent-maintained `.handoff/flows.yaml`, headless replay with screenshots and fixture states, `check` for CI) work on any app. Click-to-source (M3) and PR review come next.

Handoff adds a Figma-style Dev Mode on top of any web app's running dev server. One command starts it. Devs and their agents get exact specs, click-to-source links, end-to-end flows and a guided tour of what changed. It never edits your app, never ships to production and never sends code off your machine.

```bash
cd your-app
npx ember-handover@next
```

Handoff starts your dev server (or attaches to the one already running), serves it at `http://localhost:4000` and adds a Dev Mode pill. Press `D` to open the panel, `F` for flows.

On first run it offers (once, in your terminal) to connect your coding agent: it shows the exact diff, then writes a marked block in `AGENTS.md`, an MCP entry, and `.handoff/flows.yaml` drafted from your routes. Undo with `npx ember-handover remove`.

```bash
npx ember-handover check   # in CI: schema, route coverage, secret scan, replay every flow
```

- Product and technical spec: [`SPEC.md`](./SPEC.md)
- Decisions on open points: [`DECISIONS.md`](./DECISIONS.md)
- Security policy and threat model: [`SECURITY.md`](./SECURITY.md)

## Developing

Requires Node 22.13+ and pnpm 11.

```bash
pnpm install
pnpm exec playwright install chromium   # once, for browser tests
pnpm check       # lint, typecheck, build, unit + security + accuracy tests (install fixtures/tokens first, see CI)
pnpm test:e2e    # real Vite/Next templates (install fixtures first, see CI)
```

| Path | What |
|---|---|
| `packages/cli` | The `ember-handover` / `handoff` binary. The only published package. |
| `packages/core` | `explain(code)` error catalogue, local API + overlay server, loopback-only listening, Host/Origin/token guards. |
| `packages/proxy` | Streams the app through `127.0.0.1:4000`, injects the bridge tag, adds its hash to CSP, passes websockets (HMR) through. |
| `packages/bridge` | ~3 KB in-page script: closed shadow root, cross-origin overlay iframe, schema-checked postMessage. |
| `packages/overlay` | Preact + Tailwind v4 iframe UI: pill, Inspect panel, copy formats. Fonts bundled locally. |
| `packages/tokens` | Colour maths (CSS Color 4, CIEDE2000, WCAG), token loaders (Tailwind v4 `@theme`, v3 config, CSS variables), matching, drift, copy formats. |
| `packages/capture` | Headless re-measure for states and breakpoints via the user's Chrome (`playwright-core`). |
| `fixtures/seeded` | 50 seeded elements for the Layer 1 accuracy test. |
| `fixtures/tokens` | Tailwind v3, Tailwind v4 and CSS-variable token fixtures. |
| `fixtures/flows-app` | Small checkout app with flows, a fixture state and a deliberately broken flow. |
| `fixtures/templates` | Generated Vite (React, Vue, Svelte, Solid) and Next (App, Pages) apps for e2e. |
| `e2e/` | Runs Handoff against each template: overlay appears, HMR works. |
| `security/` | One test file per control S1–S14, plus supply-chain checks. Controls not yet built are `todo` with their milestone. |

## Licence

MIT
