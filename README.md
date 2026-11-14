# Handoff (`ember-handover`)

> Working name. Early development (M1): the proxy, bridge and an empty Dev Mode panel work on Vite and Next apps. Inspect, flows and review come next.

Handoff adds a Figma-style Dev Mode on top of any web app's running dev server. One command starts it. Devs and their agents get exact specs, click-to-source links, end-to-end flows and a guided tour of what changed. It never edits your app, never ships to production and never sends code off your machine.

```bash
cd your-app
npx ember-handover@next
```

Handoff starts your dev server (or attaches to the one already running), serves it at `http://localhost:4000` and adds a Dev Mode pill. Press `D` to open the panel.

- Product and technical spec: [`SPEC.md`](./SPEC.md)
- Decisions on open points: [`DECISIONS.md`](./DECISIONS.md)
- Security policy and threat model: [`SECURITY.md`](./SECURITY.md)

## Developing

Requires Node 22.13+ and pnpm 11.

```bash
pnpm install
pnpm exec playwright install chromium   # once, for browser tests
pnpm check       # lint, typecheck, build, unit + security tests
pnpm test:e2e    # real Vite/Next templates (install fixtures first, see CI)
```

| Path | What |
|---|---|
| `packages/cli` | The `ember-handover` / `handoff` binary. The only published package. |
| `packages/core` | `explain(code)` error catalogue, local API + overlay server, loopback-only listening, Host/Origin/token guards. |
| `packages/proxy` | Streams the app through `127.0.0.1:4000`, injects the bridge tag, adds its hash to CSP, passes websockets (HMR) through. |
| `packages/bridge` | ~3 KB in-page script: closed shadow root, cross-origin overlay iframe, schema-checked postMessage. |
| `packages/overlay` | Preact + Tailwind v4 iframe UI (pill and panel), fonts bundled locally. |
| `fixtures/templates` | Generated Vite (React, Vue, Svelte, Solid) and Next (App, Pages) apps for e2e. |
| `e2e/` | Runs Handoff against each template: overlay appears, HMR works. |
| `security/` | One test file per control S1–S14, plus supply-chain checks. Controls not yet built are `todo` with their milestone. |

## Licence

MIT
