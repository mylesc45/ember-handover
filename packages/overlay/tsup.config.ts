import { defineConfig } from "tsup";

// The overlay ships as one ES module served by the core server at /overlay.js.
// Preact and every other overlay dependency are bundled in; nothing is fetched at runtime.
export default defineConfig({
  entry: { overlay: "src/main.tsx" },
  format: ["esm"],
  platform: "browser",
  target: "es2022",
  outDir: "dist",
  clean: true,
  minify: true,
  sourcemap: false,
  noExternal: [/.*/],
  outExtension: () => ({ js: ".js" }),
  esbuildOptions(o) {
    o.jsx = "automatic";
    o.jsxImportSource = "preact";
  },
});
