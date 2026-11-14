import { readFileSync } from "node:fs";
import type http from "node:http";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../../fixtures/seeded/", import.meta.url));

/** Static handler for fixtures/seeded: the page with 50 measured elements. */
export const seededHandler: http.RequestListener = (req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/fonts/seed-mono.woff2") {
    res.writeHead(200, { "content-type": "font/woff2" });
    return res.end(readFileSync(`${dir}fonts/seed-mono.woff2`));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(`${dir}index.html`));
};
