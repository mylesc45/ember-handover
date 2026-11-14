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

## 2026-11-14 · M2

| # | Decision | Why |
|---|---|---|
| D26 | **Size is the rendered border box** (`getBoundingClientRect`), so a transformed element reports its on-screen size; the transform is shown under Effects. Box-model sides (padding, border, margin) are computed values. | Matches what the dev sees and Playwright's ground truth; transforms stay visible rather than silently undone. |
| D27 | **The bridge sends raw computed values; the overlay normalises them** (colour → hex/OKLCH, token matching, drift, copy formats) with `@ember-handover/tokens`. | Keeps the in-page script small and dumb; one normalisation implementation is reused by the overlay now and MCP/export later. |
| D28 | **States and breakpoints are re-measured in headless Chromium via `playwright-core`** (zero dependencies), preferring the user's installed Chrome, then an existing Playwright Chromium. **Handoff never downloads a browser.** If none is found, `explain("BROWSER_MISSING")` says how to get one. | SPEC asks for "lazy install … with checksum verification", but Playwright publishes no checksums and doesn't verify downloads, so we can't meet that control yet. **Open question for the maintainer.** |
| D29 | **"Active" forces `:hover` + `:active` + `:focus`**; Hover forces `:hover`; Focus forces `:focus`; Disabled sets the `disabled` attribute on Handoff's own headless copy. Running CSS transitions are finished before measuring. | That's what a real press does in Chrome (verified against real hover/press/focus/disabled in tests). Never measure mid-transition. |
| D30 | **`POST /api/measure` only loads the proxied app:** URL origin must be the proxy's, element paths must match a strict `tag:nth-child(n) > …` grammar, width 200–3840, body ≤ 16 KB. | The endpoint drives a real browser, so it must not become an SSRF or selector-injection vector (S3). |
| D31 | **Tailwind v3 configs are resolved by the project's own `tailwindcss` in a child process** (`node -e`, argument array, 15 s timeout). Tailwind v4 and CSS variables are parsed as text, never executed. | v3 configs are JS; the dev server already runs them. Running them out-of-process keeps Handoff's process clean; v4 needs no execution at all. |
| D32 | **Token matching by value**, rem at 16 px. Lengths: exact, else nearest within 2 px ("off by N"). Colours: exact 8-bit sRGB + alpha, else nearest within **CIEDE2000** ΔE 3 (CIELAB D50, as CSS `lab()`). Tailwind v4 spacing: every whole/half step of `--spacing` is a token. | SPEC's drift thresholds; ΔE2000 is the industry standard and verified against the Sharma et al. reference pairs. |
| D33 | **Pinning happens on pointer release** at the pointer position (`elementFromPoint`). While inspecting, page pointer events are swallowed in the capture phase. | Disabled controls never receive `click`; measuring after release keeps `:active` styles out of the spec. |
| D34 | **When hover/focus styles are live on the pinned element, the panel says so** ("Your pointer is over this element…"). | "Never confidently wrong": otherwise hover values could be mistaken for defaults. |
| D35 | **Width switcher lives in the Inspect panel (with States), not the toolbar**, showing Live · 375 · nearest-to-768 · nearest-to-1280. | At 360 px the toolbar can't fit tabs, widths and close; widths only apply to Inspect anyway. Search and dock controls will need the same treatment. |
| D36 | **Source row and Notes are not shown yet** (M3 and later). | Showing an unconfirmed source link would break "never confidently wrong". |
| D37 | **Bridge is ~12 KB minified** (SPEC estimated ~8 KB). | Measurement, accessible-name and role logic, and the highlight. Worth trimming later; correctness first. |

## 2026-11-14 · M4 (built before M3, at the maintainer's request)

| # | Decision | Why |
|---|---|---|
| D38 | **M4 is built before M3**, on a branch stacked on M2. | Maintainer's call. M4 doesn't depend on click-to-source; `check` reports unresolved steps without needing source links. |
| D39 | **Flows Live mode only navigates the user's tab** (new bridge command `navigate`, same-origin paths only). Clicks and typing are replayed headlessly, with a screenshot per step. | Keeps S4 intact: the bridge never clicks, types or writes the app's DOM. Chosen by the maintainer. |
| D40 | **Fixtures are same-origin network mocks**: `{"routes":[{"url":"/api/pay","method":"POST","status":402,"json":{…}}]}`, applied from step `at` (1-based) onward during headless replay. Strict schema, ≤1 MB, ≤100 routes, only `content-type` may be set, URLs must be same-origin paths (trailing `*` = prefix). | SPEC names fixtures but doesn't define them. Chosen by the maintainer. |
| D41 | **The MCP entry is written at first run** (`npx -y ember-handover mcp`) even though the server ships in M6. | Matches SPEC's first-run list; avoids a fourth write later. Chosen by the maintainer. |
| D42 | **The AGENTS.md block runs `npx ember-handover check`**, not `npx handoff check`. | `handoff` on npm is someone else's package: telling agents to `npx` it would run third-party code. Otherwise the block is SPEC's text verbatim. |
| D43 | **`wait` is seconds** (`wait: 2`), or a unit (`500ms`, `1.5s`); max 10 s. | Matches SPEC's "max 10 s"; designers and agents think in seconds. |
| D44 | **First run asks one question, in a terminal only**, after printing the exact diff it would apply. A "no" is remembered per repo in `~/.ember-handover/state.json` (outside the repo). No terminal (CI, piped) → never asks, never writes. | "Shows a diff before writing" with a single question; never nags; never writes without a person saying yes. |
| D45 | **`.handoff/cache/` is ignored via `.handoff/.gitignore`**, not the repo's root `.gitignore`. | Keeps every write inside the three allowed places. |
| D46 | **`remove` restores byte-for-byte** using an install record in `.handoff/cache/install.json` when files are unchanged since setup; otherwise it removes only the marked block / the `handoff` MCP key. It asks first (it deletes `.handoff/`), or takes `--yes` in scripts. | S14 "clean git status", without clobbering edits made after setup. `--yes` is the one new flag. |
| D47 | **JSON MCP configs are re-serialised with their detected indent** when the entry is added. | A textual JSON patcher would be fragile; `remove` restores the original bytes from the install record. |
| D48 | **`check` replays the default state of every flow**, not fixture states, and starts (or attaches to) the dev server itself. | States often intentionally change outcomes (a declined card shouldn't reach "Payment"); the default path is what must keep working. |
| D49 | **Routes are detected from files, never by running app code**: Next (App/Pages), SvelteKit, Nuxt, Astro file routes; React/Vue/Solid router `path` strings read as text; otherwise `/`. Dynamic routes can't get a drafted flow and are listed as comments for the agent. | Read-only detection; `check` still fails until a flow with an example URL covers them (SPEC: "fails if a route has no flow"). |
| D50 | **F, C and I switch panel modes from the page too** (forwarded by the bridge, never prevented). | SPEC's keyboard shortcuts must work wherever focus is; not preventing them keeps the app's own shortcuts working. |
| D51 | **The secret scanner** uses gitleaks-style rules (cloud keys, tokens, private keys, JWTs, credentials in URLs, hard-coded credential assignments) and reports rule + line, never the value. | S9/`check`; echoing a secret into CI logs would leak it. |
