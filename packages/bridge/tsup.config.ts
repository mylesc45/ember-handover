import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bridge: "src/bridge.ts" },
  format: ["iife"],
  platform: "browser",
  target: "es2020",
  outDir: "dist",
  clean: true,
  minify: true,
  sourcemap: false,
  outExtension: () => ({ js: ".js" }),
});
