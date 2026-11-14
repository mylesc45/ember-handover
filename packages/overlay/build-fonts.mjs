// Copies the variable fonts into dist/fonts so the overlay never requests Google Fonts (SPEC S10).
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const fonts = {
  "inter-var.woff2": ["@fontsource-variable/inter", "inter-latin-wght-normal.woff2"],
  "jetbrains-mono-var.woff2": ["@fontsource-variable/jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2"],
};
mkdirSync("dist/fonts", { recursive: true });
for (const [out, [pkg, file]] of Object.entries(fonts)) {
  copyFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), "files", file), join("dist/fonts", out));
}
