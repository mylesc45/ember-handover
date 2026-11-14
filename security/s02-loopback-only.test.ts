// S2 — Local servers reachable from the network.
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { listenLoopback } from "@ember-handover/core";
import { describe, expect, it } from "vitest";
import { rel, shippedSourceFiles } from "./lib/repo.js";

function externalAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i): i is NonNullable<typeof i> => !!i && !i.internal)
    .map((i) => i.address);
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.connect({ host, port, timeout: 1000 });
    s.once("connect", () => (s.destroy(), resolve(true)));
    s.once("error", () => resolve(false));
    s.once("timeout", () => (s.destroy(), resolve(false)));
  });
}

describe("S2 servers bind loopback only", () => {
  it("no shipped source mentions a wildcard bind address", () => {
    for (const file of shippedSourceFiles()) {
      const src = readFileSync(file, "utf8");
      expect(src, rel(file)).not.toMatch(/0\.0\.0\.0|['"`]::['"`]|INADDR_ANY/);
    }
  });

  it("listenLoopback binds 127.0.0.1 (and ::1 when available) and nothing else", async () => {
    const bound = await listenLoopback(() => http.createServer((_q, s) => s.end("ok")), 4400);
    try {
      for (const server of bound.servers) {
        const addr = server.address() as net.AddressInfo;
        expect(["127.0.0.1", "::1"]).toContain(addr.address);
        expect(addr.port).toBe(bound.port);
      }
      expect(await canConnect("127.0.0.1", bound.port)).toBe(true);
      for (const ip of externalAddresses()) {
        expect(await canConnect(ip, bound.port), `reachable on ${ip}`).toBe(false);
      }
    } finally {
      await bound.close();
    }
  });

  it("listenLoopback skips ports that are taken", async () => {
    const first = await listenLoopback(() => http.createServer(), 4450);
    const second = await listenLoopback(() => http.createServer(), first.port);
    try {
      expect(second.port).not.toBe(first.port);
    } finally {
      await first.close();
      await second.close();
    }
  });
});
