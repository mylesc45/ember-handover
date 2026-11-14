import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };

// Internal workspace packages are bundled into the single published CLI.
// execa and playwright-core stay real dependencies so they are visible to audits and provenance.
// The bridge and overlay builds are copied in as static assets.
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
  external: ["execa", "playwright-core", "yaml"],
  define: { __HANDOFF_VERSION__: JSON.stringify(version) },
  banner: { js: "#!/usr/bin/env node" },
  onSuccess: async () => {
    mkdirSync("dist/assets/overlay", { recursive: true });
    cpSync("../bridge/dist/bridge.js", "dist/assets/bridge.js");
    cpSync("../bridge/dist/measure.js", "dist/assets/measure.js");
    cpSync("../overlay/dist", "dist/assets/overlay", { recursive: true });
  },
});
