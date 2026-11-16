// Dev server for the checkout fixture: `node server.mjs --port 5199`.
import { readFileSync } from "node:fs";
import http from "node:http";

const port = Number(process.argv[process.argv.indexOf("--port") + 1] || 5199);
const html = readFileSync(new URL("./index.html", import.meta.url));
http
  .createServer((req, res) => {
    if (req.url === "/api/pay" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end('{"ok":true}');
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  })
  .listen(port, "127.0.0.1", () => console.log(`  Local: http://localhost:${port}/`));
