import { defineConfig, type Options } from "tsup";

const shared: Options = {
  format: ["iife"],
  platform: "browser",
  target: "es2020",
  outDir: "dist",
  minify: true,
  sourcemap: false,
  outExtension: () => ({ js: ".js" }),
};

export default defineConfig([
  // Injected into the app page by the proxy.
  { ...shared, entry: { bridge: "src/bridge.ts" }, clean: true },
  // Loaded only into Handoff's own headless pages (states, breakpoints).
  { ...shared, entry: { measure: "src/measure-global.ts" }, clean: false },
]);
