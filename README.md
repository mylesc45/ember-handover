# Handoff (`ember-handover`)

> Working name. Early development: M0 (foundations) only. Nothing runs against your app yet.

Handoff adds a Figma-style Dev Mode on top of any web app's running dev server. One command starts it. Devs and their agents get exact specs, click-to-source links, end-to-end flows and a guided tour of what changed. It never edits your app, never ships to production and never sends code off your machine.

```bash
npx ember-handover@next --help
```

- Product and technical spec: [`SPEC.md`](./SPEC.md)
- Decisions on open points: [`DECISIONS.md`](./DECISIONS.md)
- Security policy and threat model: [`SECURITY.md`](./SECURITY.md)

## Developing

Requires Node 22.13+ and pnpm 11.

```bash
pnpm install
pnpm check     # lint, typecheck, build, all tests (including security/)
```

| Path | What |
|---|---|
| `packages/cli` | The `ember-handover` / `handoff` binary. The only published package. |
| `packages/core` | Shared core: `explain(code)` error catalogue (later: local server, `.handoff/` IO, path guards). |
| `security/` | One test file per control S1–S14, plus supply-chain checks. Controls not yet built are `todo` with their milestone. |

## Licence

MIT
