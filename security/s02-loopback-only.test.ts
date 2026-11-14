// S2 — Local servers reachable from the network.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rel, shippedSourceFiles } from "./lib/repo.js";

describe("S2 servers bind loopback only", () => {
  it("no shipped source mentions a wildcard bind address", () => {
    for (const file of shippedSourceFiles()) {
      const src = readFileSync(file, "utf8");
      expect(src, rel(file)).not.toMatch(/0\.0\.0\.0|['"`]::['"`]|INADDR_ANY/);
    }
  });
  it.todo("M1: proxy, overlay and core servers report listen address 127.0.0.1 / ::1");
  it.todo("M1: connection from a non-loopback interface is refused");
});
