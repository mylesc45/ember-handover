import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
    rules: {
      // Security model S7: processes only via execa with argument arrays.
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "child_process", message: "Use execa with an argument array (SPEC S7)." },
            { name: "node:child_process", message: "Use execa with an argument array (SPEC S7)." },
          ],
        },
      ],
      "no-eval": "error",
      "no-new-func": "error",
      "no-implied-eval": "error",
      "no-console": "error",
    },
  },
  {
    // Tests may spawn processes directly to exercise the built CLI.
    files: ["**/test/**", "security/**"],
    rules: { "no-restricted-imports": "off" },
  },
);
