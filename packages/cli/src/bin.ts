import { main } from "./main.js";

import { createInterface } from "node:readline/promises";

const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true && !process.env.CI;

process.exitCode = await main(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  ...(interactive
    ? {
        ask: async (q: string) => {
          const rl = createInterface({ input: process.stdin, output: process.stdout });
          try {
            return (await rl.question(q)).trim();
          } finally {
            rl.close();
          }
        },
      }
    : {}),
});
