import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { createInjector } from "../src/index.js";

const TAG = '<script src="/__handoff/bridge.js"></script>';

async function inject(chunks: (string | Buffer)[]): Promise<string> {
  const out = Readable.from(chunks.map((c) => (typeof c === "string" ? Buffer.from(c) : c))).pipe(createInjector(TAG));
  return (await buffer(out)).toString("utf8");
}

describe("HTML injector", () => {
  it("inserts the tag before </head>", async () => {
    expect(await inject(["<html><head><title>x</title></head><body></body></html>"])).toBe(
      `<html><head><title>x</title>${TAG}</head><body></body></html>`,
    );
  });

  it("finds </head> split across chunks", async () => {
    expect(await inject(["<html><head></he", "AD ><body>hi</body>"])).toBe(`<html><head>${TAG}</heAD ><body>hi</body>`);
  });

  it("injects exactly once even if </head> appears again", async () => {
    const out = await inject(["<head></head><body><pre>&lt;/head&gt;</pre><template></head></template></body>"]);
    expect(out.split(TAG).length - 1).toBe(1);
  });

  it("appends the tag when the document has no </head>", async () => {
    expect(await inject(["<p>fragment</p>"])).toBe(`<p>fragment</p>${TAG}`);
  });

  it("preserves multi-byte and non-UTF-8 bytes exactly", async () => {
    const bytes = Buffer.concat([Buffer.from("<head>"), Buffer.from([0xe2, 0x82]), Buffer.from([0xac, 0x93, 0xff]), Buffer.from("</head>")]);
    const out = Readable.from([bytes.subarray(0, 7), bytes.subarray(7)]).pipe(createInjector(TAG));
    const result = await buffer(out);
    expect(result).toEqual(Buffer.concat([bytes.subarray(0, 11), Buffer.from(TAG), Buffer.from("</head>")]));
  });

  it("streams: output starts before the input ends", async () => {
    const injector = createInjector(TAG);
    const seen: string[] = [];
    injector.on("data", (c: Buffer) => seen.push(c.toString()));
    injector.write("<html><head></head><body>" + "x".repeat(100));
    await new Promise((r) => setImmediate(r));
    expect(seen.join("")).toContain(TAG);
    injector.end();
  });
});
