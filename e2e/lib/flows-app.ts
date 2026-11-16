import { readFileSync } from "node:fs";
import type http from "node:http";
import { fileURLToPath } from "node:url";

export const flowsAppDir = fileURLToPath(new URL("../../fixtures/flows-app/", import.meta.url));

/** Static checkout app: every page path serves the SPA; POST /api/pay succeeds. */
export const flowsAppHandler: http.RequestListener = (req, res) => {
  if (req.url === "/api/pay" && req.method === "POST") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(`${flowsAppDir}index.html`));
};
