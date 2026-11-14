import { describe, expect, it } from "vitest";
import { parseBridgeEvent, parseOverlayCommand } from "../src/protocol.js";

describe("overlay → bridge commands", () => {
  it("accepts well-formed commands", () => {
    expect(parseOverlayCommand({ v: 1, type: "hello" })).toEqual({ v: 1, type: "hello" });
    expect(parseOverlayCommand({ v: 1, type: "layout", mode: "panel" })).toEqual({ v: 1, type: "layout", mode: "panel" });
  });

  it.each([
    null,
    undefined,
    "hello",
    42,
    [],
    { type: "hello" },
    { v: 2, type: "hello" },
    { v: 1, type: "eval", code: "alert(1)" },
    { v: 1, type: "layout", mode: "fullscreen" },
    { v: 1, type: "layout", mode: "panel", extra: true },
    { v: 1, type: "hello", __proto__: { polluted: true } },
    Object.create({ v: 1, type: "hello" }),
  ])("rejects %j", (msg) => {
    expect(parseOverlayCommand(msg)).toBeNull();
  });
});

describe("bridge → overlay events", () => {
  it("accepts well-formed events", () => {
    expect(parseBridgeEvent({ v: 1, type: "key", key: "toggle" })).toEqual({ v: 1, type: "key", key: "toggle" });
    expect(parseBridgeEvent({ v: 1, type: "page", url: "http://localhost:4000/a", title: "A" })).toEqual({
      v: 1,
      type: "page",
      url: "http://localhost:4000/a",
      title: "A",
    });
  });

  it("caps string lengths", () => {
    expect(parseBridgeEvent({ v: 1, type: "page", url: "u".repeat(5000), title: "t" })).toBeNull();
    expect(parseBridgeEvent({ v: 1, type: "page", url: "u", title: "t".repeat(600) })).toBeNull();
  });

  it.each([{ v: 1, type: "key", key: "rm -rf" }, { v: 1, type: "page", url: 1, title: "t" }, { v: 1, type: "token" }])(
    "rejects %j",
    (msg) => expect(parseBridgeEvent(msg)).toBeNull(),
  );
});
