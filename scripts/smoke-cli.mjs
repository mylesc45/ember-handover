// Runtime smoke test of the built CLI using only Node built-ins, so it runs on
// the oldest supported Node (20) even though the dev toolchain needs Node 22+.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../packages/cli/dist/bin.js", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8"));
const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: "utf8" });

let r = run("--version");
assert.equal(r.status, 0, r.stderr);
assert.equal(r.stdout.trim(), version);

r = run("--help");
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /review/);

r = run("frobnicate");
assert.equal(r.status, 2);
assert.match(r.stderr, /Fix:/);
assert.doesNotMatch(r.stderr, /\n\s+at .+:\d+:\d+/);

r = run("review");
assert.equal(r.status, 1);
assert.match(r.stderr, /Fix:/);

console.log(`CLI smoke test passed on Node ${process.version}`);
