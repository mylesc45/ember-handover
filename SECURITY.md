# Security policy

Handoff is a dev-only, local-only tool. Its job is to add zero attack surface to your repo and zero footprint to your production app. We treat security bugs as release blockers.

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through GitHub's private vulnerability reporting:

**https://github.com/mylesc45/ember-handover/security/advisories/new**

We aim to acknowledge every report within **72 hours** and to agree a disclosure date with you once a fix is ready. Credit is given unless you ask otherwise.

## Supported versions

Until 1.0, only the latest published `next` release gets security fixes.

## What we protect

- **Production:** no Handoff code, route, attribute or header ever ships.
- **Your machine:** servers bind to loopback only; untrusted files (flows, notes, PR code) never get to execute Handoff-level commands.
- **Your repo:** no unreviewed writes. Source code is never modified.
- **Secrets:** `.env` values, tokens, cookies and customer data never leave the machine or enter exports.

The full threat model (controls S1–S14) is in [`SPEC.md`](./SPEC.md#security-model). Each control has an automated test in [`security/`](./security).

## Honest limits

`handoff review <pr>` runs the PR's app code in a dev server, the same as checking the branch out yourself. Install scripts are blocked by default, but the app's own code still runs. For PRs from outside contributors, use `--sandbox`.

## Supply chain

- Releases are published only from GitHub Actions using npm trusted publishing (OIDC) with provenance attestations. No personal npm tokens exist for this package.
- No Handoff package has `install` or `postinstall` scripts; this is enforced by a test.
- The published CLI is kept under 40 transitive dependencies; this is enforced by a test.
- No dependency is allowed to run install scripts in this repo (`allowBuilds` in `pnpm-workspace.yaml`).
