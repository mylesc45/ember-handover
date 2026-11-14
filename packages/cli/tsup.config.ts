import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

// Internal workspace packages are bundled into the single published CLI,
// so the published package has zero runtime dependencies in M0.
export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: false,
  splitting: false,
  noExternal: [/^@ember-handover\//],
  define: { __HANDOFF_VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node" },
});
