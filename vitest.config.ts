import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "core", root: "packages/core", include: ["test/**/*.test.ts"] } },
      { test: { name: "cli", root: "packages/cli", include: ["test/**/*.test.ts"], testTimeout: 30_000 } },
      { test: { name: "security", root: "security", include: ["**/*.test.ts"], exclude: ["node_modules/**"] } },
    ],
  },
});
