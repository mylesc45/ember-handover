import { defineConfig } from "vitest/config";

const unit = (name: string, root: string, extra: Record<string, unknown> = {}) => ({
  test: { name, root, include: ["test/**/*.test.ts"], ...extra },
});

export default defineConfig({
  test: {
    projects: [
      unit("core", "packages/core"),
      unit("cli", "packages/cli", { testTimeout: 30_000 }),
      unit("proxy", "packages/proxy"),
      unit("bridge", "packages/bridge"),
      {
        test: {
          name: "security",
          root: "security",
          include: ["**/*.test.ts"],
          exclude: ["node_modules/**"],
          testTimeout: 30_000,
        },
      },
      {
        // Real templates in fixtures/templates; slow, run with `pnpm test:e2e`.
        test: { name: "e2e", root: "e2e", include: ["**/*.test.ts"], fileParallelism: false, testTimeout: 120_000 },
      },
    ],
  },
});
