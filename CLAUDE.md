# Handoff: instructions for Claude Code

You are building **Handoff**, a dev-only design-to-dev handoff tool. `SPEC.md` in this repo is the source of truth. Read it in full before writing any code.

## How to work

1. Build one milestone at a time, in the order given in SPEC.md → "Build plan". Start with M0.
2. For each milestone, write the tests named in its "Done when" line first, then implement until they pass.
3. Don't start the next milestone until the current one's tests are green. Then stop and summarise what was built, what's tested, and any open questions.
4. If SPEC.md is ambiguous or conflicts with itself, ask before guessing. Record decisions in `DECISIONS.md`.

## Non-negotiables (from SPEC.md → Security model)

- The Security section's controls S1–S14 are acceptance criteria, each with an automated test.
- Bind only to `127.0.0.1` / `::1`. Never `0.0.0.0`.
- Never run shell strings: use `execa` with argument arrays only.
- Never modify the user's app source code. Only write the three files listed in "First run", after showing a diff.
- No telemetry, no outbound network calls in a default run. Fonts and assets are bundled locally.
- No `install` or `postinstall` scripts in any Handoff package.
- Every new dependency needs a one-line reason in the PR description. Keep the CLI under 40 transitive dependencies.
- MCP tools are read-only: no file writes, shell or network.
- Flow files and notes are untrusted input: closed step vocabulary, safe YAML parsing, size caps, rendered as plain text.

## Stack

- pnpm monorepo, TypeScript strict, Node 22.13+.
- Overlay: Preact + Tailwind v4 using the `@theme` tokens in SPEC.md → "UI design system". Dark-only in v1.
- Use the package layout in SPEC.md → "Build plan → Repo layout".

## UX bar

"Don't make me think": one command, zero config, one primary action per view, and every error goes through a single `explain(code)` function that returns a plain sentence and a fix. No raw stack traces for users.
