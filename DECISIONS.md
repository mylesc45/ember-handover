# Decisions

Decisions on points SPEC.md leaves open or ambiguous. Newest last.

## 2026-11-14 · M0

| # | Decision | Why |
|---|---|---|
| D1 | **Licence: MIT.** | Chosen by the maintainer (SPEC open decision). Maximises adoption. |
| D2 | **npm name: `ember-handover`.** The bins are `ember-handover` and `handoff`. | `handoff` is taken on npm. Chosen by the maintainer. `npx ember-handover` is the documented command until naming is final; the `handoff` bin keeps `npx handoff`-style muscle memory once installed. |
| D3 | **Only the CLI is published.** Internal packages are `@ember-handover/*`, `private: true`, and are bundled into the CLI with tsup. | Keeps the runtime dependency count minimal (0 in M0), gives one provenance attestation, and avoids publishing a dozen half-empty packages. |
| D4 | **Packages are created when their milestone starts.** M0 has `cli` and `core` only, plus `security/`. | Empty package skeletons add noise and maintenance without testing anything. The repo layout in SPEC is still the target. |
| D5 | **"Test registry with provenance" = public npmjs under the `next` dist-tag.** | npm provenance is only issued by the public registry via GitHub OIDC; a private test registry can't satisfy "with provenance". Prereleases go out as `0.0.0-alpha.N` on `next`, so `latest` stays empty until 1.0. Chosen by the maintainer. |
| D6 | **Argument parsing uses `node:util` `parseArgs`, not `citty` or `commander`.** | Zero dependencies (SPEC caps the CLI at 40). Our flag set is tiny and fixed. Revisit if subcommand help gets complex. |
| D7 | **`explain(code)` lives in `@ember-handover/core`.** The CLI exits 0 on success, 1 when a command fails, 2 on a usage error. `--json` prints errors as `{"error":{code,message,fix}}`. | One catalogue that every package can use. Exit codes follow common CLI convention so CI can tell a misuse apart from a real failure. |
| D8 | **TypeScript 6, not 7.** | typescript-eslint 8 does not support TS 7 yet. Revisit when it does. |
| D9 | **S7 is enforced statically:** shipped source may not import `child_process` at all (lint rule plus security test). Only `execa` with argument arrays may start processes. | Stronger and simpler than pattern-matching `exec(` calls. |
| D10 | **No dependency may run install scripts in this repo** (`allowBuilds: { esbuild: false }`). | Mirrors the "no install scripts" rule for our own deps; esbuild works through its optional platform binaries. |
| D11 | **Security reports go through GitHub private vulnerability reporting**, not an email address. | Meets SPEC's "private disclosure address" without publishing personal contact details. |
| D12 | **GitHub Actions are pinned to commit SHAs.** | Supply-chain hardening; Renovate (planned) keeps them current. |
| D13 | ~~Superseded by D14.~~ **Two Node floors: the CLI runs on Node 20.11+; developing Handoff needs Node 22.13+.** CI runs the full suite on Node 22 on all 3 OSes, then switches to the matrix runtime (20 or 22) and smoke-tests the built CLI with `scripts/smoke-cli.mjs` (Node built-ins only). | pnpm 11, vitest 5 and tsup 9 all require Node 22+, while SPEC promises users Node 20+. Note that Node 20 reached end-of-life in April 2026. See the open question in the M0 summary. |

## 2026-11-14 · Node floor

| # | Decision | Why |
|---|---|---|
| D14 | **One Node floor for users and contributors: 22.13+.** CI matrix is Node 22 and 24 on macOS, Ubuntu and Windows. SPEC.md and CLAUDE.md updated to match. Supersedes D13. | Node 20 reached end-of-life in April 2026, and pnpm 11, vitest 5 and tsup 9 need 22+. Chosen by the maintainer. |

## 2026-11-14 · M1

| # | Decision | Why |
|---|---|---|
| D15 | **Detector and supervisor live in `packages/cli`**, not their own packages. | They are CLI orchestration and used nowhere else; SPEC's repo layout has no package for them. |
| D16 | **Proxy is built on `node:http`/`node:net` directly**, not `http-proxy-3` or `undici`. | SPEC offers either; the stdlib covers request streaming and raw websocket passthrough in ~200 lines, with zero dependencies (CLI budget). |
| D17 | **Bridge is injected as `<script src="/__handoff/bridge.js" integrity="sha384-…" defer>`, and that same SRI hash is what's added to CSP.** | CSP3 hash sources match external scripts via their `integrity`. If a policy relies on `'unsafe-inline'` with no nonce/hash, we leave it untouched, because adding a hash would make browsers ignore `'unsafe-inline'` and break the app. `<meta>` CSP is not rewritten in v1. |
| D18 | **The API token is in the overlay's HTML (`<meta>`), never in the page or on the postMessage channel.** The page can't read it: the overlay is cross-origin, sends `Cross-Origin-Resource-Policy: same-origin`, the API requires the token in a header, and Host/Origin checks defeat rebinding. | Any secret handed to the page would be visible to the app's own scripts, so none is. |
| D19 | **Overlay treats every bridge event as untrusted data.** Events only change what is displayed (page title/URL, D/Esc). They are rendered as text and can never trigger an API call with page-chosen parameters. | A hostile script in the app page can forge anything the bridge can send; origin checks alone can't tell them apart. |
| D20 | **The bridge speaks first** (on iframe load); the overlay queues commands until it learns the parent origin. | Avoids broadcasting to every loopback origin, which prints console errors in the user's app. |
| D21 | **The framing allowlist is `http://localhost:<port>` and `http://127.0.0.1:<port>`; `[::1]` is excluded.** Servers still bind `::1`. | Chrome's CSP rejects IPv6 literals in `frame-ancestors`. Handoff always prints the localhost URL. |
| D22 | **Ports: proxy 4000, core/overlay 4001, each moving up to the next free port.** `listenLoopback` tracks every socket, including upgraded websockets, so shutdown never hangs on an open HMR connection. | SPEC's defaults, plus a fallback so a busy port isn't fatal. |
| D23 | **Dev server runs in its own process group (POSIX) / is killed with `taskkill /T` (Windows)** so Ctrl+C stops `pnpm run dev` *and* the server it spawns. | Otherwise the real dev server outlives Handoff and holds its port. |
| D24 | **Fixture templates are committed as generated** (create-vite 9.3.4, create-next-app 16.4.6) with their lockfiles, each as its own pnpm root. CI installs them with `--ignore-scripts`. | Reproducible matrix inputs without network-dependent generation in CI. Tailwind/CSS Modules variants come with M2. |
| D25 | **`pnpm test` = unit + security (includes Playwright for S4); `pnpm test:e2e` = real templates.** | e2e needs fixture installs and takes ~1 min; kept as a separate CI job. |
