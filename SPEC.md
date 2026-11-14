# Handoff — Product & Technical Spec

Nov 14, 2026 · @Myles

## Summary

Handoff (working name) is an open-source, dev-only tool that adds a Figma-style Dev Mode on top of any web app's running dev server. One command starts it. Devs and their agents get exact specs, click-to-source links, end-to-end flows and a guided tour of what changed. It never edits the app, never ships to production and never sends code off the machine.

**Problem.** Designers now vibe code UI with agents, but nothing turns that code into a spec a dev can trust. Figma Dev Mode assumes the design lives in Figma. The existing repo overlays (Margo, Domscribe, Vibe Annotations) only push feedback *into* an agent. Nobody owns the reverse direction: inspect, flows and change review for the dev.

**Promise.** Any web app with a dev server. Exact specs everywhere. Exact source links on React, Vue, Svelte and Angular. Zero files edited by hand. Zero production footprint.

### Product principles

1. **Don't make me think.** One command, no config, no YAML for designers. Every screen has one obvious next action.
2. **Truth from the browser, location from the source.** Specs are measured from the rendered DOM, never inferred from code.
3. **Never confidently wrong.** Every source link shows a confidence level. Ambiguity is shown, not hidden.
4. **Secure by construction.** Local-only, dev-only, read-only on the app, no telemetry by default, no network calls except to the user's own dev server.
5. **The agent does the work.** The designer's coding agent keeps flows and intent notes current; humans review.

### Targets

| Measure | Target |
| --- | --- |
| Time to first overlay on an existing repo | < 60 s |
| Files edited by hand | 0 |
| Commands to start | 1 (`npx handoff`) |
| Config files by default | 0 |
| PR review ready (warm cache) | < 30 s |
| Production bundle bytes added | 0 |
| Raw stack traces shown to users | 0 |

### Non-goals (v1)

- Native iOS, Android, React Native, Flutter, canvas or WebGL apps (no DOM to inspect).
- Editing designs or code from the overlay. Handoff reads; agents write.
- Hosting, accounts or a cloud backend.
- Replacing Storybook, Chromatic or Figma for teams that still design in Figma.

## Users and jobs

Four users, one tool. The designer's effort must stay near zero; the dev's answers must be exact.

| User | Job to be done | What they touch | Max effort they'll accept |
| --- | --- | --- | --- |
| Designer (vibe coding) | Hand over intent without writing a spec | `npx handoff` once; optional one-click notes | 1 command, then nothing |
| Designer's coding agent | Keep flows and intent notes current as UI changes | `.handoff/` files via the `AGENTS.md` rule | Follows repo instructions |
| Developer | Implement or review UI correctly first time | Overlay, Dev Mode, `npx handoff review <PR>` | 1 command or 1 link |
| Developer's agent | Fetch exact specs, flows and changes while coding | MCP tools | Zero setup beyond MCP config |
| Reviewer / PM (no local setup) | See flows and changes without cloning | Static export file from `npx handoff share` | Open a file |

### Primary scenario (v1)

A designer opens a PR with UI changes built by an agent. A dev reviews and hardens it before merge. Handoff shows the dev what changed, every affected flow, exact specs, token drift and the source location of each element.

### Secondary scenario

A prototype repo is handed to a team that will rebuild it in a production codebase. The dev's agent queries Handoff over MCP for specs and flows while implementing.

## Architecture

Handoff runs as a separate local process in front of the user's dev server. Nothing is installed into the app, so nothing can reach a production build. The overlay UI runs in an isolated cross-origin iframe, so the app's own scripts can never touch Handoff's privileged API.

```
Your machine (loopback only)
┌──────────── Browser ────────────┐
│ App page (bridge: reads DOM)    │──HTTP+HMR──▶ Proxy 127.0.0.1:4000 ──▶ Your dev server (unchanged)
│        ▲ postMessage ▼          │
│ Overlay UI iframe 127.0.0.1:4001│──API + session token──▶ Core server (resolver, tokens, capture, git; writes .handoff/ only)
└─────────────────────────────────┘                              ▲
                                       Coding agent ──stdio──▶ MCP server (read-only tools)
```

The app's scripts and Handoff's privileged API never share an origin; the only path between them is `postMessage`.

### Components

| Component | Responsibility | Tech |
| --- | --- | --- |
| CLI (`handoff`) | Entry point, preflight, commands, plain-English errors | Node 22.13+, TypeScript, `citty` or `commander` |
| Detector | Framework, package manager, dev script, port, router, token sources | Reads `package.json`, lockfiles, config files (read-only) |
| Supervisor | Starts the user's dev script if not running; restarts on crash | `execa`, no shell interpolation |
| Proxy | Serves the app on `127.0.0.1:4000`, injects one bridge `<script>`, passes through HMR websockets | `http-proxy-3` or `undici`, streaming HTML rewriter |
| Bridge (in app page) | Measures DOM, reads framework dev metadata, talks to the overlay via `postMessage` only | \~8 KB vanilla TS, no dependencies |
| Overlay UI (iframe) | All UI: inspect panel, flows player, changes tour | Preact or React + Tailwind, served from `127.0.0.1:4001` |
| Core server | Local API for the overlay; owns state in `.handoff/` | Node `http`, bound to 127.0.0.1 only |
| Resolver | Element to source file:line with confidence | Framework adapters, source maps, tree-sitter index |
| Token engine | Parses Tailwind v3/v4, CSS variables, theme files; matches computed values | PostCSS, `tailwindcss` resolver (peer, optional) |
| Capture engine | Replays flows, screenshots, breakpoints, network log | Playwright Chromium, installed lazily on first use |
| Git module | Diff vs base branch, temp worktrees for review | `git` CLI via `execa`, argument arrays only |
| MCP server | Specs, flows and changes for agents | MCP over **stdio only** |
| Exporter | Single self-contained HTML file | Inlined assets, no external requests |

### Request path

1. Browser requests `localhost:4000/page`.
2. Proxy forwards to the dev server and streams the response back.
3. If the response is `text/html`, the proxy inserts one `<script src="/__handoff/bridge.js">` before `</head>` and adds that script's hash to any CSP header.
4. The bridge mounts a closed shadow root containing a single iframe pointing at `127.0.0.1:4001`. All UI lives in that iframe.
5. Bridge and iframe talk only through `postMessage`, with strict origin checks both ways and a per-session token.

### Why proxy mode, not a build plugin

- Works with any framework that serves HTML, including Rails, Django and Laravel front ends.
- Zero files changed, so zero production risk and no merge noise.
- A build plugin remains available (`npx handoff precise`) only to raise source-mapping accuracy, and it is dev-only by construction (see Security).

## Framework support and accuracy

Specs are exact on every framework because they are measured from the rendered browser. Only click-to-source depends on the framework, and it always shows its confidence.

### Layer 1: specs (framework-agnostic, exact)

| Spec | How it's measured |
| --- | --- |
| Size, position, padding, margin, gap | `getBoundingClientRect`, computed box model |
| Typography (family, weight, size, line height, letter spacing) | `getComputedStyle` plus `document.fonts` for the loaded face |
| Colour, opacity, borders, radius, shadows | Computed styles, normalised to hex and OKLCH |
| Layout mode (flex, grid, alignment) | Computed styles on element and parent |
| Token match | Exact lookup against parsed tokens: `match`, `off by N`, or `no token` |
| Responsive behaviour | Re-measured at each breakpoint in headless Chromium |
| States (hover, focus, active, disabled) | Forced pseudo-states via Chrome DevTools Protocol `CSS.forcePseudoState` |
| Assets | SVG markup, image URLs, font files from DOM and network log |
| Accessibility | Role, accessible name, contrast ratio against WCAG 2.2 AA |

### Layer 2: click-to-source (adapters)

Resolution runs in order and stops at the first confirmed answer.

| Priority | Method | Frameworks | Expected exact rate (estimate, to verify) |
| --- | --- | --- | --- |
| 1 | Build plugin `data-hs` attribute (opt-in `precise`) | Vite, Next, Webpack, Angular CLI | \~100% |
| 2 | Framework dev metadata | React (fiber + owner stacks), Vue (`__file`), Svelte (`__svelte_meta`), Angular (`ng` debug API), Solid (dev hooks) | 95–99% |
| 3 | Source maps from dev server | Anything bundled with source maps | \~90% |
| 4 | Static tree-sitter index (text, class lists, `data-testid`, aria labels) | Anything | \~85% |

The percentages above are estimates. The compatibility matrix (Testing section) measures the real ones each release.

### Confidence rules

- **Exact**: confirmed by priority 1 or 2, or by two independent methods agreeing. Shown as a single link.
- **Likely**: one method from priority 3 or 4. Shown with a "Likely" badge and up to 3 candidates ranked.
- **Unknown**: no candidate above threshold. Shown as "Can't locate this element" with the reason and a one-click fix (for example: enable source maps).
- Never show a single confident link that was not confirmed.

### Supported at launch

React 18/19 (Vite, Next App and Pages routers, Remix / React Router 7), Vue 3 (Vite, Nuxt 3/4), Svelte 5 (SvelteKit), Angular 17+ (CLI, SSR), Astro, Solid, and plain HTML. Styling: Tailwind v3 and v4, CSS Modules, plain CSS variables, styled-components, Emotion, MUI, shadcn/ui.

### Not supported

Native mobile, React Native, Flutter web (canvas renderer), canvas or WebGL UIs, and production builds without source maps (Layer 2 degrades to Likely).

## Designer and agent workflow

The designer runs one command once. After that, their coding agent maintains everything Handoff needs, and the designer never edits a Handoff file.

### First run: `npx handoff`

1. Preflight (< 5 s): Node version, git repo, dev script, port, source maps, token sources. Problems are shown as one sentence plus a fix.
2. Starts or attaches to the dev server and opens `localhost:4000` with the overlay.
3. Asks one question in the terminal: **"Connect your coding agent so it keeps handoff notes up to date? (Y/n)"**
4. On yes, writes exactly three things and shows a diff before writing:
   - A marked block in `AGENTS.md` (also `CLAUDE.md` or `.cursor/rules/handoff.mdc` if those exist).
   - An MCP entry in the agent's project config (`.mcp.json`, `.cursor/mcp.json`), using `npx handoff mcp` over stdio.
   - A `.handoff/` folder with `flows.yaml` drafted from detected routes, plus a `.gitignore` entry for `.handoff/cache/`.
5. Nothing else in the repo changes. `npx handoff remove` reverses all three exactly.

### The AGENTS.md rule (inserted verbatim)

```markdown
<!-- handoff:start -->
## Handoff notes
When you add or change UI:
1. Update `.handoff/flows.yaml` so every user-facing flow you touched has accurate steps.
2. Add a one-line `intent` to any step whose purpose is not obvious from the UI.
3. Add `data-testid` to interactive elements you create.
4. Run `npx handoff check` and fix any failures before finishing.
Do not put secrets, real customer data or credentials in `.handoff/`.
<!-- handoff:end -->
```

### `flows.yaml` schema

Flows use a closed, declarative step vocabulary. There is no `eval`, no custom script and no shell step, so a flow file from an untrusted PR cannot execute code.

```yaml
version: 1
baseUrl: /                 # relative only; absolute URLs rejected
fixtures: .handoff/fixtures # optional mock data for states
flows:
  - id: checkout
    name: Checkout
    intent: Buy a plan in under 3 steps
    steps:
      - goto: /pricing
        intent: User compares plans
      - click: { testid: plan-pro }
      - fill: { testid: email, value: "test@example.com" }
      - click: { role: button, name: Continue }
      - expect: { text: "Payment" }
        state: default
    states:              # alternate states of the same flow
      - id: card-declined
        fixture: payments/declined.json
        at: 4
```

Allowed step verbs: `goto`, `click`, `fill`, `select`, `hover`, `press`, `scroll`, `wait` (max 10 s), `expect`. Selectors: `testid`, `role` + `name`, `text`, `label`. CSS selectors are allowed but flagged as fragile.

### Notes from the designer (optional)

In the overlay, the designer can click any element and type a note. It's saved to `.handoff/notes.json` keyed by a stable element fingerprint (source location + test ID + text). One click, no forms.

### `npx handoff check`

Runs in under 30 s locally and in CI. Fails if a route has no flow, a flow step no longer resolves, a flow file breaks the schema, or `.handoff/` contains anything that looks like a secret.

## Developer workflow

A dev gets everything through one of three doors: the live overlay, a PR review command, or a shared file. Their agent gets the same data over MCP.

### 1. Live overlay

- Press `D` (or click the floating pill) to toggle Dev Mode. Press `Esc` to leave.
- Hover any element to see its box model; click to pin the Inspect panel.
- Every value has a copy button. Copy formats: CSS, Tailwind classes, or tokens.
- The Source row opens the file at the line in the dev's editor (`vscode://`, `cursor://`, `idea://`, detected from `$EDITOR`).

### 2. PR review: `npx handoff review 142`

1. Reads the PR's head and base via `gh` if installed, else `git fetch origin pull/142/head`.
2. Creates a temporary git worktree in the OS temp folder. The dev's working copy is never touched.
3. Installs dependencies with `--ignore-scripts` from a shared cache, then starts the dev server in that worktree.
4. Builds the Changes tour: changed files mapped to components, components mapped to routes and flows.
5. Opens the tour. When the dev exits, the worktree and its processes are removed.

Install scripts are off by default because PR code is untrusted. If the app genuinely needs them, the dev confirms once per repo with `--allow-scripts`, shown with a clear warning.

### 3. Shared file: `npx handoff share`

Produces one self-contained `handoff-<branch>-<date>.html` (target < 15 MB): screenshots, specs, flows, the changes tour and notes. It makes no network requests and runs no app code. Anyone opens it in a browser.

### What the Changes tour shows

| Item | Detail |
| --- | --- |
| Changed screens | Before / after screenshots per flow step, with a slider and a pixel-diff toggle |
| Changed components | Component name, file, lines changed, every place it renders |
| Spec deltas | e.g. "Button padding 12 → 16 px", "Primary colour changed from token to hard-coded #F64668" |
| Token drift | New hard-coded values that are within 2 px or ΔE 3 of an existing token |
| New and broken flows | Steps added, removed, or failing |
| Accessibility regressions | New contrast failures, missing names on controls |

### MCP tools for the dev's agent

| Tool | Returns |
| --- | --- |
| `get_spec(selector or testid, route)` | Layer 1 specs + tokens + source with confidence |
| `list_flows()` / `get_flow(id)` | Steps, intents, states, screenshot paths |
| `get_changes(base?)` | Structured diff: screens, components, spec deltas, drift |
| `get_tokens()` | Parsed design tokens |
| `get_notes(route?)` | Designer notes with element fingerprints |

All MCP tools are read-only. There is no MCP tool that writes files, runs commands or fetches URLs.

## Security model

Handoff must add zero attack surface to a repo or a production app. Every control below is a release blocker, and every one has an automated test.

### What we protect

- Production: no Handoff code, route, attribute or header ever ships.
- The dev's machine: no remote access, no code execution from untrusted files.
- The repo: no unreviewed writes; source code is never modified.
- Secrets: `.env` values, tokens, cookies and customer data never leave the machine or enter exports.

### Threats and controls

| ID | Threat | Control | Verified by |
| --- | --- | --- | --- |
| S1 | Handoff code reaches a production build | Proxy mode installs nothing in the app. The optional `precise` plugin uses Vite `apply: 'serve'`, Next `PHASE_DEVELOPMENT_SERVER`, Angular dev builder only, and throws if `NODE_ENV=production`. Package is a devDependency. | CI builds every matrix template in prod mode and scans output for the marker `__handoff`; any hit fails |
| S2 | Local servers reachable from the network | Bind `127.0.0.1` and `::1` only. No `--host 0.0.0.0` option in v1. | Test asserts listen address; port scan from a second container fails |
| S3 | Malicious website calls the local API (CSRF, DNS rebinding) | Host header allowlist (`localhost`, `127.0.0.1`); Origin check; 256-bit per-session token in a header (not a cookie); no CORS headers; all writes require `POST` with JSON content type | Rebinding and cross-origin fetch tests |
| S4 | App or third-party scripts in the page abuse Handoff | All UI and the token live in a cross-origin iframe. Bridge exposes no globals, validates every message against a schema, and accepts commands only from the iframe origin. Bridge can read the DOM only, never write it except its own shadow root. | Hostile-page test suite tries to read the token and drive the bridge |
| S5 | Untrusted PR files execute code during review | Flow DSL has no code steps; YAML parsed with `yaml` in core schema, no custom tags, size cap 1 MB, alias cap 100; notes rendered as plain text only | Fuzzing of parsers; XSS payload corpus in notes and flow names |
| S6 | PR install scripts run on the dev's machine | `review` installs with `--ignore-scripts` by default; worktree lives in an OS temp folder; optional `--sandbox` runs it in Docker when available | Test PR with malicious `postinstall` proves it never runs |
| S7 | Command injection | All processes started via `execa` with argument arrays, never a shell; PR numbers must be integers; branch names validated against git's ref rules | Injection strings in PR, branch and path inputs |
| S8 | Path traversal or symlink escape | Every file read or write is resolved with `realpath` and must stay inside the repo root or `.handoff/`; editor deep links only open such paths | Traversal and symlink test corpus |
| S9 | Secrets leak via exports, screenshots or logs | Network log drops `Authorization`, `Cookie`, `Set-Cookie` and query params named like tokens; exports exclude `.env*`; secret scanner (gitleaks rules) runs on `.handoff/` and every export; banner reminds to use fixtures for screenshots | Seeded-secret tests on export output |
| S10 | Telemetry leaks code or data | No telemetry by default. Optional failure report is shown in full before sending and contains only detected framework, versions and error code | Network egress test: zero outbound requests in default run |
| S11 | Proxy weakens the app's own security | Proxy only adds the bridge script's hash to `script-src`; it never removes headers or loosens other CSP directives | Header diff test on every matrix template |
| S12 | Prompt injection into agents via notes or flows | MCP responses wrap user-authored text in typed fields marked untrusted; length caps (2,000 chars per note); MCP tools are read-only with no file, shell or network access | Injection corpus run against the MCP server |
| S13 | Shared export runs code when opened | Export has CSP `default-src 'none'`, inline styles and scripts by hash only, no app JS, no external URLs | CSP lint and headless open with network blocked |
| S14 | Unwanted repo changes | Only three known files written, after showing a diff; marked blocks; `npx handoff remove` restores exactly | Snapshot test of `init` then `remove` gives a clean `git status` |

### Supply chain

- Dependencies: target under 40 transitive packages for the CLI; every new dependency needs a written reason in the PR.
- No `install` or `postinstall` scripts in Handoff's own packages.
- Publish only from GitHub Actions with npm trusted publishing (OIDC) and provenance attestations. No personal tokens.
- Maintainers: hardware-key 2FA on npm and GitHub; protected `main`; signed tags.
- Playwright Chromium installs on first use, from the official CDN, with checksum verification.
- Automated: Renovate, CodeQL, OpenSSF Scorecard, Socket.dev alerts, and an SBOM attached to each release.

### Honest limits

`review` runs the PR's app code in a dev server, the same as checking the branch out. Install scripts are blocked, but the app's own code still runs. Tell users this plainly in the docs and the first-run message, and recommend `--sandbox` for PRs from outside contributors.

### Security process

- `SECURITY.md` with a private disclosure address and a 72-hour acknowledgement target.
- Threat model kept in the repo and reviewed each minor release.
- External security review before 1.0.

## UI design system

The overlay uses the Embers palette on a dark navy base, built with Tailwind v4. It ships dark-only in v1, like browser DevTools, so it reads clearly on top of any app. All text pairs below pass WCAG 2.2 AA (measured contrast ratios shown).

### Palette and roles

| Token | Hex | Role | Key contrast |
| --- | --- | --- | --- |
| `ember-indigo` | #41436A | Raised surfaces, hover, selected rows | White text 9.39:1 |
| `ember-plum` | #984063 | Secondary buttons, badges, "Likely" confidence | White text 6.46:1 |
| `ember-coral` | #F64668 | Primary action, selection outline, focus ring, changes accent | `ink-950` text 5.25:1; vs `ink-900` as non-text 4.31:1 |
| `ember-peach` | #FE9677 | Links, highlighted values, token-drift warnings | On `ink-900` 7.08:1 |
| `ink-950` | #0F1420 | Text on coral and peach fills | — |
| `ink-900` | #1E2638 | Panel background | — |
| `ink-800` | #262F42 | Cards inside panels | — |
| `ink-700` | #2D3A4F | Palette background; toolbar, dividers region | — |
| `fg-primary` | #FFFFFF | Body text | On `ink-900` 15.11:1 |
| `fg-secondary` | #B8BDD0 | Labels, metadata | On `ink-900` 8.08:1 |
| `fg-disabled` | #7E86A3 | Disabled text only (exempt from AA) | 4.19:1 |

`ink-700` is sampled from the palette image's background; the other `ink` and `fg` values are derived. White text on coral (3.5:1) fails AA, so coral buttons always use `ink-950` text. Status colours (success, error) reuse peach and coral plus an icon, so colour never carries meaning alone.

### Tailwind v4 theme

```css
@import "tailwindcss";

@theme {
  --color-ember-indigo: #41436A;
  --color-ember-plum:   #984063;
  --color-ember-coral:  #F64668;
  --color-ember-peach:  #FE9677;

  --color-ink-950: #0F1420;
  --color-ink-900: #1E2638;
  --color-ink-800: #262F42;
  --color-ink-700: #2D3A4F;

  --color-fg-primary:   #FFFFFF;
  --color-fg-secondary: #B8BDD0;
  --color-fg-disabled:  #7E86A3;

  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, monospace;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;

  --shadow-panel: 0 12px 32px rgb(15 20 32 / 0.45);
}
```

Fonts are bundled locally (no Google Fonts request), which keeps the zero-egress guarantee.

### Type scale

| Use | Size / line height | Weight |
| --- | --- | --- |
| Panel title | 15 / 20 px | 600 |
| Body, values | 13 / 18 px | 400 |
| Labels | 12 / 16 px | 500, `fg-secondary` |
| Code and measurements | 12 / 16 px mono | 400 |

### Core components

| Component | Spec |
| --- | --- |
| Primary button | `bg-ember-coral text-ink-950 font-semibold h-8 px-3 rounded-md`; hover 8% lighter; focus `ring-2 ring-ember-coral ring-offset-2 ring-offset-ink-900` |
| Secondary button | `bg-ember-plum text-fg-primary h-8 px-3 rounded-md` |
| Ghost button | `text-fg-secondary hover:bg-ember-indigo/60 h-8 px-2 rounded-md` |
| Value row | Label left (`fg-secondary`), value right (mono), copy icon on hover; whole row is the click target |
| Confidence badge | Exact: peach dot + "Exact" · Likely: plum pill + "Likely" · Unknown: outline pill + "Can't locate" |
| Token chip | `rounded-sm bg-ink-800 px-1.5 font-mono`; drift shows a peach underline and "off by 1 px" |
| Selection outline | 2 px `ember-coral` with 4 px corner handles; padding area tinted coral at 15%, margin tinted peach at 15% |
| Toast | Bottom-centre, `bg-ink-800`, auto-dismiss 3 s, never for errors needing action |

### Interaction rules ("Don't make me think")

- One primary action per view, always coral, always bottom-right of the panel.
- Every number is copyable with a single click; copy confirms inline ("Copied") for 1.5 s.
- No modal dialogs in the overlay. Settings live in one drawer.
- Keyboard: `D` toggle, `Esc` back, `↑ ↓` parent / child element, `F` flows, `C` changes, `/` search. Shown in a `?` cheat sheet.
- Motion: 150 ms ease-out on panels; respect `prefers-reduced-motion`.
- The panel docks right by default (360 px), can dock left or bottom, and remembers per repo.

## UI screens

The UI has three modes: Inspect, Flows and Changes. They share one panel and one toolbar, so a user learns the layout once.

### Idle state

A 32 px pill floats bottom-right over the app: Handoff logo, then "Dev Mode" and a `D` key hint. It is draggable and its position is remembered. It hides automatically during flow capture and screenshots.

### Toolbar (top of panel, 44 px)

Left to right: mode tabs (Inspect · Flows · Changes, with a coral count badge on Changes), search (`/`), breakpoint switcher (detected breakpoints, e.g. 375 · 768 · 1280), dock position, close.

### Inspect

| Region | Content |
| --- | --- |
| Header | Component name (e.g. `PricingCard`), element tag, test ID; breadcrumb of parents, each clickable |
| Source | `src/components/PricingCard.tsx:42` with confidence badge and "Open in editor" |
| Layout | Width × height, box-model diagram with editable-looking but copy-only values, flex/grid summary |
| Typography | Font, size, weight, line height, letter spacing, each with token chip |
| Colour | Swatches for text, background, border with hex + token |
| Effects | Radius, shadow, opacity, transitions |
| States | Toggle row: Default · Hover · Focus · Active · Disabled; values update live |
| Accessibility | Role, name, contrast ratio with pass/fail |
| Notes | Designer notes on this element; "Add note" ghost button |
| Copy as | Primary button with a menu: CSS · Tailwind · Tokens · Prompt for agent |

"Prompt for agent" copies a ready-made, structured block (specs, source, intent) for pasting into any coding agent.

### Flows

1. **List**: each flow shows name, intent, step count, status (Passing · Stale · Failing) and a thumbnail strip.
2. **Player**: a stepper across the top (step 3 of 7), the step's intent in one line, and a Live / Screenshot toggle. Live mode drives the real app to that step; Screenshot mode shows the captured frame.
3. **States**: a segmented control under the stepper (Default · Empty · Error · Loading) when the flow defines them.
4. Clicking any element in a step opens Inspect for it, then "Back to flow" returns.

### Changes (guided tour)

1. **Summary card**: "12 changes across 3 flows and 5 components" with counts for spec deltas, token drift, accessibility issues and broken flows.
2. **Tour**: one change per screen, ordered by flow and step. Before / after slider, the change list for that screen, and a single coral "Next change" button. `← →` keys move through.
3. Each change can be marked "Looks right" or "Question". Questions are saved to `.handoff/review.json` and can be copied as PR comments.
4. **Done screen**: totals reviewed, open questions, and "Copy review summary".

### Empty and error states

| Situation | What the user sees |
| --- | --- |
| No flows yet | "Your agent will add flows as it builds. Or record one now." + Record button |
| Source not found | "Can't locate this element: source maps are off." + "Fix it" (shows the one-line change) |
| Dev server crashed | Panel stays open, banner: "Your app stopped. Restarting…" with the last 5 log lines |
| Flow step fails | Step marked Failing, screenshot of where it stopped, the expected vs actual line |
| Unsupported page (canvas) | "This area is drawn on a canvas, so it can't be inspected." |

### Shared export viewer

The same Flows and Changes UI, read-only, with Inspect working on captured snapshots (DOM + computed styles serialised at capture). Live mode is hidden.

## CLI and data formats

Seven commands; most users only ever run the first.

### Commands

| Command | Does | Writes to repo |
| --- | --- | --- |
| `npx handoff` | Preflight, start or attach to dev server, proxy, overlay; first run offers agent setup | Only on first-run "Y": `AGENTS.md` block, MCP config, `.handoff/` |
| `npx handoff review <pr>` | Temp worktree, install (no scripts), run, open Changes tour | No (temp folder) |
| `npx handoff share` | Capture flows and changes, write one HTML file | The export file, to `./handoff-exports/` (git-ignored) |
| `npx handoff check` | Validate flows, routes coverage, schema, secret scan; exit code for CI | No |
| `npx handoff mcp` | MCP server over stdio for agents | No |
| `npx handoff doctor` | Full diagnostics with fixes; `--json` for bug reports | No |
| `npx handoff remove` | Remove everything Handoff added | Removes only its own additions |

Flags kept to a minimum: `--port`, `--base <branch>`, `--sandbox`, `--allow-scripts`, `--precise`, `--json`. No flag is ever required.

### `.handoff/` folder

| Path | Committed | Contents |
| --- | --- | --- |
| `flows.yaml` | Yes | Flows, steps, intents, states (schema in Designer workflow) |
| `notes.json` | Yes | Designer notes keyed by element fingerprint |
| `review.json` | Yes | Questions raised in Changes tour |
| `fixtures/` | Yes | Mock data for flow states; fake data only |
| `config.ts` | Only if created | Overrides: port, token sources, ignored routes |
| `cache/` | No (git-ignored) | Screenshots, index, captured snapshots |

### `notes.json` entry

```json
{
  "version": 1,
  "notes": [
    {
      "id": "n_7f3a",
      "fingerprint": { "source": "src/components/PricingCard.tsx:42", "testid": "plan-pro", "text": "Pro" },
      "route": "/pricing",
      "body": "Highlight this plan; it's the default recommendation.",
      "author": "designer",
      "createdAt": "2026-11-14T13:00:00Z"
    }
  ]
}
```

### `get_spec` MCP response (abridged)

```json
{
  "element": { "component": "PricingCard", "testid": "plan-pro", "route": "/pricing" },
  "source": { "file": "src/components/PricingCard.tsx", "line": 42, "confidence": "exact", "method": "react-fiber" },
  "box": { "width": 320, "height": 412, "padding": [24, 24, 24, 24], "gap": 16 },
  "typography": { "family": "Inter", "size": 16, "weight": 600, "lineHeight": 24, "token": "text-base/semibold" },
  "colors": { "bg": { "hex": "#FFFFFF", "token": "white" }, "border": { "hex": "#E4E4E7", "token": "zinc-200" } },
  "drift": [ { "prop": "borderRadius", "value": 14, "nearestToken": "rounded-xl", "tokenValue": 12, "delta": 2 } ],
  "notes": [ { "body": "Highlight this plan; it's the default recommendation.", "untrusted": true } ]
}
```

## Testing and acceptance

A release ships only if the full compatibility matrix and the security suite pass. "Works first time" is enforced by CI, not hoped for.

### Compatibility matrix (runs on every PR and release)

| Template | Frameworks covered |
| --- | --- |
| `create-next-app` (App + Pages router) | React 19, Next 15/16 |
| `create-vite` react-ts, vue-ts, svelte-ts, solid-ts | React, Vue, Svelte, Solid on Vite |
| `ng new` (with and without SSR) | Angular 17+ |
| `nuxi init` | Vue / Nuxt |
| `sv create` | SvelteKit |
| `create-astro` (with React islands) | Astro |
| `create-react-router` | React Router 7 / Remix |
| Plain HTML + CSS | No framework |
| Each of the above × Tailwind v3, Tailwind v4, CSS Modules | Styling |
| React + shadcn/ui, MUI, styled-components | Component libraries |

Matrix size: about 25 templates × 3 OSes (macOS, Ubuntu, Windows) × Node 22 and 24.

### Per-template assertions

- [ ] `npx handoff` reaches a working overlay in under 60 s on a cold cache, 15 s warm.
- [ ] HMR still works through the proxy (edit a file, page updates in under 2 s).
- [ ] Layer 1 specs match a Playwright ground-truth measurement on 50 seeded elements: 100%.
- [ ] Click-to-source accuracy on 50 seeded elements meets the framework target; no "Exact" link is ever wrong.
- [ ] Token matching correct on seeded exact, off-by-1 and no-token values.
- [ ] Production build contains zero `__handoff` markers.
- [ ] `init` then `remove` leaves a clean `git status`.

### Security suite

Each control S1–S14 in the Security section has its own test, run on every PR. Parsers (YAML, notes JSON, flow DSL) are fuzzed nightly with 10 million inputs.

### Real-world beta

Before 1.0, run on 30 real vibe-coded repos (from Lovable, v0, Bolt, Cursor and Claude Code exports). Exit criteria: 90% reach a working overlay with zero manual steps, and every failure has a clear `doctor` message.

### Metrics after launch (opt-in failure reports only)

- First-run success rate (target ≥ 95%).
- Share of source links shown as Exact (target ≥ 90% on supported frameworks).
- Time to first overlay (target median < 30 s).

## Build plan

Nine milestones over roughly 14 weeks for one person working with coding agents. An MVP gate at week 5 decides whether to continue, using dogfooding on your own repos. Each milestone ends with its tests green; an agent should not start the next milestone until then.

### Repo layout (pnpm monorepo)

```
handoff/
  packages/
    cli/          # handoff binary, commands, preflight, doctor
    core/         # local server, state, .handoff/ IO, path guards
    proxy/        # HTML injection, CSP hash, websocket passthrough
    bridge/       # in-page script, DOM measurement, postMessage
    overlay/      # iframe UI: Preact + Tailwind v4
    resolver/     # adapters: react, vue, svelte, angular, solid, sourcemap, treesitter
    tokens/       # Tailwind v3/v4, CSS vars, theme parsers
    capture/      # Playwright flows, screenshots, breakpoints
    git/          # diff, worktree, PR fetch
    mcp/          # stdio MCP server, read-only tools
    exporter/     # single-file HTML
    plugin/       # optional dev-only build plugins (precise mode)
  fixtures/       # matrix templates + seeded elements
  security/       # tests per control S1–S14, fuzzers
```

### Milestones

1. **M0 Foundations (week 1).** Monorepo, TypeScript strict, lint, CI on 3 OSes, release pipeline with npm provenance, `SECURITY.md`, security test scaffolding for S1–S14.
   - Done when: empty CLI publishes to a test registry from CI with provenance.
2. **M1 Proxy, bridge, overlay shell (weeks 2–3).** Detector, supervisor, proxy with HTML injection and CSP hash, HMR passthrough, cross-origin iframe, token handshake, idle pill and empty panel.
   - Done when: overlay appears on all Vite and Next templates, HMR works, and S2, S3, S4, S11 tests pass.
3. **M2 Inspect and tokens (weeks 3–4).** Layer 1 specs, box-model overlay, states via CDP, copy formats, token engine for Tailwind v3/v4 and CSS variables, drift detection.
   - Done when: 100% Layer 1 accuracy against Playwright ground truth on seeded elements.
4. **M3 Source for React and Vue (week 5).** Fiber + owner stacks, Vue `__file`, source-map fallback, confidence badges, open-in-editor.
   - Done when: React and Vue meet targets and no wrong "Exact". **MVP gate:** dogfood on 3 of your own repos for a week.
5. **M4 Flows (weeks 6–7).** `flows.yaml` schema and parser, route detection, draft generation, agent setup on first run, Playwright replay, player UI, states with fixtures, `check` command.
   - Done when: flows replay on all templates; S5 and S14 pass.
6. **M5 Changes and review (weeks 8–9).** Git diff to components to routes, before/after capture, spec deltas, tour UI, `review` with temp worktree and `--ignore-scripts`.
   - Done when: review of a seeded PR ready in under 30 s warm; S6, S7, S8 pass.
7. **M6 Share and MCP (week 10).** Single-file exporter with strict CSP, secret scrubbing, read-only MCP server.
   - Done when: S9, S12, S13 pass; export opens with network blocked.
8. **M7 More frameworks (week 11).** Svelte, Angular, Solid adapters, tree-sitter fallback, optional `precise` plugins.
   - Done when: full matrix green; S1 passes for every plugin.
9. **M8 Hardening and 1.0 (weeks 12–14).** Beta on 30 real repos, doctor messages for every failure seen, docs site, external security review, accessibility audit of the overlay.
   - Done when: beta exit criteria met and the security review has no open high or critical findings.

### Instructions for the implementing agent

- Work one milestone at a time; write the tests named in "Done when" first.
- Never add a dependency without noting why in the PR description.
- Never run a shell string; use argument arrays. Never bind to anything but loopback.
- Every user-facing error goes through one `explain(code)` function that returns a sentence and a fix.
- Treat the Security section as acceptance criteria, not guidance.

## Risks and open decisions

The biggest risk is trust: one wrong "Exact" link or one security incident ends adoption. Both are handled by hard rules above; the rest are below.

### Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Proxy breaks an unusual dev server (custom HTTPS, middleware, service workers) | High | Medium | Matrix coverage; `doctor` detects and offers `precise` plugin mode as fallback |
| Agents forget to update `flows.yaml` | Medium | High | `check` in CI blocks PRs with uncovered routes; overlay marks stale flows |
| React or Angular changes dev internals | Medium | Medium | Adapters isolated per framework version; source-map fallback always on |
| Incumbent tool (Margo, Domscribe, Figma) adds a dev-facing mode | Medium | Medium | Differentiate on accuracy, token drift and the review tour; ship fast |
| Playwright download (\~150 MB) feels heavy | Medium | Low | Lazy install only when flows or review are first used; reuse an existing install |
| `review` runs untrusted app code | Certain (by design) | High for external PRs | Clear warning, scripts off, `--sandbox` recommended for external contributors |

### Open decisions

- [ ] **Name.** "Handoff" is a working name; check npm and trademark availability.
- [ ] **Licence.** MIT for adoption, or Apache-2.0 for the patent grant.
- [ ] **Light theme.** Dark-only in v1, or ship light at 1.0.
- [ ] **Sandbox default.** Make `--sandbox` the default for PRs from forks when Docker is present.
- [ ] **Monetisation.** Stay fully open source, or add a paid hosted share link later (would need its own security review).
