import { once } from "node:events";
import type { Server } from "node:http";
import type { Socket } from "node:net";
import { HandoffError } from "./explain.js";

export interface Bound {
  port: number;
  servers: Server[];
  close(): Promise<void>;
}

/** IPv6 loopback may be missing (some containers); that's fine. */
const V6_UNAVAILABLE = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "EINVAL"]);

async function tryListen(server: Server, port: number, host: string): Promise<string | null> {
  try {
    server.listen({ port, host, exclusive: true });
    await once(server, "listening");
    return null;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code ?? "UNKNOWN";
  }
}

const sockets = new WeakMap<Server, Set<Socket>>();

/** Track every socket, including upgraded websockets that closeAllConnections() misses. */
function track(server: Server): Server {
  const set = new Set<Socket>();
  sockets.set(server, set);
  server.on("connection", (s: Socket) => {
    set.add(s);
    s.once("close", () => set.delete(s));
  });
  return server;
}

const closeAll = (servers: Server[]) =>
  Promise.all(
    servers.map(
      (s) =>
        new Promise<void>((r) => {
          if (!s.listening) return r();
          s.close(() => r());
          for (const sock of sockets.get(s) ?? []) sock.destroy();
        }),
    ),
  ).then(() => undefined);

/**
 * Listen on 127.0.0.1 and ::1 only (SPEC S2), on the first port from `start`
 * where both are free. There is deliberately no option to bind anything else.
 */
export async function listenLoopback(make: () => Server, start: number, tries = 50): Promise<Bound> {
  for (let port = start; port < start + tries && port <= 65535; port++) {
    const v4 = track(make());
    if ((await tryListen(v4, port, "127.0.0.1")) !== null) continue;
    const v6 = track(make());
    const err6 = await tryListen(v6, port, "::1");
    if (err6 === null) return bound(port, [v4, v6]);
    if (V6_UNAVAILABLE.has(err6)) return bound(port, [v4]);
    await closeAll([v4]);
  }
  throw new HandoffError("NO_FREE_PORT", { port: start });
}

function bound(port: number, servers: Server[]): Bound {
  return { port, servers, close: () => closeAll(servers) };
}
