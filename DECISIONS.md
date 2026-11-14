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
